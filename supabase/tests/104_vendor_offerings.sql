-- TRACE-134 (6.11A, 20261104001000). Synthetic fixtures only.
-- (1) A price version that is live or in use keeps its content and its references on every path:
--     vendor, operator and owner writes to the package, levels, add-ons and questions are refused;
--     pausing and operator suspension/archive still work; a delete is refused.
-- (2) vendor_save_package saves changed content as the next revision (atomic, stale-guarded, keyed),
--     or in place for a paused version no one has used; vendor_set_package_active publishes/pauses.
-- (3) Vendor A cannot touch vendor B; anonymous callers cannot call the commands.
-- (4) The Managed Pricing guardrail is computed on the server.
-- (5) Vendors no longer write legacy promotions or service ZIP codes; operators still do; exact ZIP
--     matching is unchanged and ZIP codes are five digits.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
 ('c1040000-0000-4000-8000-000000000001','vo-operator@example.invalid',now()),
 ('c1040000-0000-4000-8000-000000000002','vo-vendor-a@example.invalid',now()),
 ('c1040000-0000-4000-8000-000000000003','vo-vendor-b@example.invalid',now()),
 ('c1040000-0000-4000-8000-000000000004','vo-homeowner@example.invalid',now());
delete from public.user_roles where user_id in ('c1040000-0000-4000-8000-000000000002','c1040000-0000-4000-8000-000000000003');
insert into public.user_roles(user_id,role) values
 ('c1040000-0000-4000-8000-000000000001','admin'),
 ('c1040000-0000-4000-8000-000000000002','vendor'),
 ('c1040000-0000-4000-8000-000000000003','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id,services) values
 ('c1041000-0000-4000-8000-00000000000a','Synthetic offerings vendor A',true,true,'c1040000-0000-4000-8000-000000000002','{synthetic-vo-svc}'),
 ('c1041000-0000-4000-8000-00000000000b','Synthetic offerings vendor B',true,true,'c1040000-0000-4000-8000-000000000003','{synthetic-vo-svc}');
insert into public.service_categories(id,name) values ('synthetic-vo-cat','Synthetic offerings');
insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,pricing_mode,default_frequency,available_frequencies,is_active) values
 ('synthetic-vo-svc','Synthetic offerings service','synthetic-vo-cat',100,100,'fixed','monthly','{one-time,monthly}',true);
insert into public.coverage_areas(zip_code,city,is_active) values ('33901','Fort Myers',true),('33903','North Fort Myers',true)
  on conflict (zip_code) do update set is_active = true;
delete from public.coverage_areas where zip_code = '00104';
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('c1041000-0000-4000-8000-00000000000a','33901'),('c1041000-0000-4000-8000-00000000000a','00104'),
 ('c1041000-0000-4000-8000-00000000000b','33901');

create function pg_temp.as_user(p_n integer) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1040000-0000-4000-8000-00000000000'||p_n||'"}',true) $$;
create function pg_temp.vendor(p_x text) returns uuid language sql as $$ select ('c1041000-0000-4000-8000-00000000000'||p_x)::uuid $$;
create function pg_temp.stamp(p_draft uuid) returns timestamptz language sql security definer as $$
 select updated_at from private.operator_package_drafts where id = p_draft $$;
create function pg_temp.rev(p_package uuid) returns text language sql security definer as $$ select private.package_revision_hash(p_package) $$;
create function pg_temp.age(p_contractor uuid) returns void language sql as $$
 update public.vendor_packages set created_at = now() - interval '1 day' where contractor_id = p_contractor $$;
create function pg_temp.content(p_name text, p_price numeric) returns jsonb language sql as $$
 select jsonb_build_object('service_id','synthetic-vo-svc',
   'package', jsonb_build_object('name',p_name,'description','Synthetic monthly service','pricing_mode','fixed','default_frequency','monthly'),
   'questions', jsonb_build_array(jsonb_build_object('question_key','beds','question_label','Bedrooms','input_type','number','is_required',false)),
   'tiers', jsonb_build_array(jsonb_build_object('name','Monthly','price',p_price,'frequency','monthly','includes',jsonb_build_array('Visit'))),
   'addons', jsonb_build_array(jsonb_build_object('name','Synthetic extra','price',15))) $$;
create function pg_temp.matched(p_zip text) returns text language sql security definer as $$
 select coalesce(string_agg(contractor_name || ':' || effective_price, ',' order by contractor_name), '')
   from private.find_eligible_packages_with_answers(null,'synthetic-vo-svc','monthly',p_zip,null,null) $$;
create temp table ids(name text primary key, id uuid);
grant all on ids to authenticated, anon;
create temp table saved(name text primary key, r jsonb);
grant all on saved to authenticated;

-- Live prices published by the operator for A and B (100/month, inside the 25-400 band).
select pg_temp.as_user(1);
set local role authenticated;
insert into ids select 'draft-' || v, (public.admin_save_package_draft_content(null, null, pg_temp.vendor(v), 'synthetic-vo-svc', null,
  jsonb_build_object('name','Synthetic plan ' || v,'description',null,'pricing_mode','fixed','deposit_amount',null,'included_scope','[]'::jsonb,
    'policy_notes',null,'questions','[]'::jsonb,
    'tiers',jsonb_build_array(jsonb_build_object('id','t1','name','Monthly','frequency','monthly','price_kind','exact','price',100)),
    'addons',jsonb_build_array(jsonb_build_object('id','a1','name','Synthetic extra','price',15))))->>'id')::uuid
  from unnest(array['a','b']) v;
select public.admin_publish_package_draft(id, pg_temp.stamp(id), 'Synthetic seed') from ids where name like 'draft-%';
reset role;
insert into ids select 'p', id from public.vendor_packages where contractor_id = pg_temp.vendor('a');
insert into ids select 'pb', id from public.vendor_packages where contractor_id = pg_temp.vendor('b');
insert into ids select 'tier', t.id from public.package_tiers t where t.package_id = (select id from ids where name='p');
insert into ids select 'addon', a.id from public.package_addons a where a.package_id = (select id from ids where name='p');
insert into public.package_qualifying_questions(package_id,question_key,question_label,input_type,is_required)
  values ((select id from ids where name='p'),'beds','Bedrooms','number',false);
select pg_temp.age(pg_temp.vendor('a'));
select pg_temp.age(pg_temp.vendor('b'));
select is(pg_temp.matched('33901'), 'Synthetic offerings vendor A:100,Synthetic offerings vendor B:100', 'both live prices match the covered ZIP');

-- A scheduled request priced from A's live version (the binding a submission records).
set local session_replication_role = replica;
insert into public.service_requests(id,customer_id,service_type,address,contractor_id,package_id,package_tier_id,status,
    service_catalog_id,frequency,zip_code,pricing_mode,total_amount,pricing_inputs)
  values ('c1042000-0000-4000-8000-000000000001','c1040000-0000-4000-8000-000000000004','Synthetic offerings service','1 Synthetic Way',
    pg_temp.vendor('a'),(select id from ids where name='p'),(select id from ids where name='tier'),'scheduled','synthetic-vo-svc','monthly','33901',
    'fixed',100,jsonb_build_object('package_id',(select id from ids where name='p'),'package_revision',pg_temp.rev((select id from ids where name='p')),'total_cents',10000));
set local session_replication_role = origin;
create temp table before as select pg_temp.rev((select id from ids where name='p')) as hash;
grant select on before to authenticated;
create function pg_temp.binding() returns text language sql security definer as $$
 select (r.package_id = (select id from ids where name='p'))::text || '/' || (r.package_tier_id = (select id from ids where name='tier'))::text
   || '/' || (r.pricing_inputs->>'package_revision' = pg_temp.rev(r.package_id))::text || '/' || r.total_amount
   from public.service_requests r where r.id = 'c1042000-0000-4000-8000-000000000001' $$;
select is(pg_temp.binding(), 'true/true/true/100.00', 'the request is bound to the version and price it was priced from');

-- (1) Every direct write path on the live, in-use version is refused — vendor A.
select pg_temp.as_user(2);
set local role authenticated;
select throws_ok($$update public.package_tiers set price = 40 where id = (select id from ids where name='tier')$$, '55000', null, 'vendor: a live level price cannot change in place');
select throws_ok($$delete from public.package_tiers where id = (select id from ids where name='tier')$$, '55000', null, 'vendor: a live level cannot be deleted');
select throws_ok($$insert into public.package_tiers(package_id,name,price,frequency) values ((select id from ids where name='p'),'Extra',90,'monthly')$$, '55000', null, 'vendor: a level cannot be added to a live version');
select throws_ok($$update public.package_addons set price = 1 where id = (select id from ids where name='addon')$$, '55000', null, 'vendor: a live add-on price cannot change in place');
select throws_ok($$update public.package_addons set is_offered = false where id = (select id from ids where name='addon')$$, '55000', null, 'vendor: a live add-on cannot be withdrawn in place');
select throws_ok($$delete from public.package_addons where id = (select id from ids where name='addon')$$, '55000', null, 'vendor: a live add-on cannot be deleted');
select throws_ok($$update public.package_qualifying_questions set question_label = 'Rooms' where package_id = (select id from ids where name='p')$$, '55000', null, 'vendor: a live question cannot change');
select throws_ok($$delete from public.package_qualifying_questions where package_id = (select id from ids where name='p')$$, '55000', null, 'vendor: a live question cannot be deleted');
select throws_ok($$update public.vendor_packages set name = 'Renamed', description = 'Changed' where id = (select id from ids where name='p')$$, '55000', null, 'vendor: live package content cannot change in place');
select throws_ok($$delete from public.vendor_packages where id = (select id from ids where name='p')$$, '55000', 'Pause this price before deleting it', 'vendor: a live package cannot be deleted');
select lives_ok($$update public.vendor_packages set is_active = false where id = (select id from ids where name='p')$$, 'vendor: pausing stays a direct action');
-- Paused but in use: still protected.
select throws_ok($$update public.package_tiers set price = 40 where id = (select id from ids where name='tier')$$, '55000', 'Requests use this price version; save your changes as a new version', 'vendor: a paused, in-use level is still protected');
select throws_ok($$delete from public.vendor_packages where id = (select id from ids where name='p')$$, '55000', 'Requests use this price version; it is kept as history and cannot be deleted', 'vendor: a paused, in-use package cannot be deleted');
select throws_ok($$update public.vendor_packages set default_frequency = 'one-time' where id = (select id from ids where name='p')$$, '55000', null, 'vendor: paused, in-use content cannot change');
select lives_ok($$update public.vendor_packages set is_active = true where id = (select id from ids where name='p')$$, 'vendor: republishing the unchanged version is allowed');
reset role;

-- Operators and owner sessions are bound by the same rule; operator commands still work.
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok($$update public.package_tiers set price = 40 where id = (select id from ids where name='tier')$$, '55000', null, 'operator: a direct in-place edit is refused too');
select throws_ok($$delete from public.vendor_packages where id = (select id from ids where name='p')$$, '55000', null, 'operator: a direct delete is refused too');
reset role;
select throws_ok($$delete from public.package_tiers where id = (select id from ids where name='tier')$$, '55000', null, 'owner session: deleting an in-use level is refused');
select is(pg_temp.binding(), 'true/true/true/100.00', 'after every refused write the request keeps its version, level, revision and amount');
select is(pg_temp.rev((select id from ids where name='p')), (select hash from before), 'and the version content is unchanged');

select lives_ok($$select private.money_source('c1042000-0000-4000-8000-000000000001')$$,
  'control: before any replacement the request''s checkout source resolves from its version');

-- (2) Vendor saves: a changed live version becomes revision 2; the old one is paused, not changed.
select pg_temp.as_user(2);
set local role authenticated;
insert into saved values ('s1', public.vendor_save_package((select id from ids where name='p'), (select hash from before),
  pg_temp.content('Synthetic plan a', 120), true, 'save-key-vo-000000001'));
select is((select (r->>'new_version')::boolean || '/' || (r->>'revision_number') || '/' || (r->>'is_active') || '/' || (r->>'needs_review')
  || '/' || ((r->>'replaced_package_id')::uuid = (select id from ids where name='p'))::text from saved where name='s1'),
  'true/2/true/false/true', 'the change is published as revision 2, replacing the live version');
insert into ids select 'p2', (r->>'package_id')::uuid from saved where name='s1';
select is(public.vendor_save_package((select id from ids where name='p'), (select hash from before),
  pg_temp.content('Synthetic plan a', 120), true, 'save-key-vo-000000001')->>'package_id',
  (select r->>'package_id' from saved where name='s1'), 'a retry with the same key returns the same revision');
select throws_ok($$select public.vendor_save_package((select id from ids where name='p'), (select hash from before),
  pg_temp.content('Synthetic plan a', 130), true, 'save-key-vo-000000001')$$, '22023', 'Save key reused with different content', 'a reused key with other content is refused');
select throws_ok($$select public.vendor_save_package((select id from ids where name='p'), (select hash from before),
  pg_temp.content('Synthetic plan a', 130), true, 'save-key-vo-000000002')$$, '40001', 'A newer version of this price was saved; reload before saving', 'saving from a superseded version is refused (no second replacement)');
select throws_ok($$select public.vendor_save_package((select id from ids where name='p2'), 'stale-hash',
  pg_temp.content('Synthetic plan a', 130), true, 'save-key-vo-000000003')$$, '40001', 'This price changed since it was read; reload before saving', 'a stale read of the newest version is refused');
select throws_ok($$select public.vendor_set_package_active((select id from ids where name='p'), true,
  (select updated_at from public.vendor_packages where id = (select id from ids where name='p')))$$, '55000', null, 'the superseded version cannot go live again');
select throws_ok($$update public.vendor_packages set is_active = true where id = (select id from ids where name='p')$$, '55000', null, 'nor directly');
reset role;
select is((select count(*)::int from public.vendor_packages where lineage_id = (select id from ids where name='p')), 2, 'exactly one replacement revision exists');
select is((select is_active::text || '/' || (select price from public.package_tiers where package_id = p.id) from public.vendor_packages p where id = (select id from ids where name='p')),
  'false/100', 'the replaced version is paused with its price unchanged');
select is(pg_temp.binding(), 'true/true/true/100.00', 'the request still names the version and price it was priced from');
select is(pg_temp.matched('33901'), 'Synthetic offerings vendor A:120,Synthetic offerings vendor B:100', 'matching offers the new revision');
-- TRACE-126 (open, unchanged): an unpaid request priced from a version replaced afterwards is not
-- re-priced; its checkout source is refused because that version is no longer live (as after an
-- operator replacement). The request keeps its stored terms.
select throws_ok($$select private.money_source('c1042000-0000-4000-8000-000000000001')$$, 'P0001', 'Selected offering is not eligible',
  'TRACE-126 (open): the replaced version cannot be checked out; nothing is re-priced');

-- In place: a paused version no one has used is rewritten, not versioned; drafts publish and pause.
select pg_temp.as_user(2);
set local role authenticated;
insert into saved values ('d1', public.vendor_save_package(null, null, pg_temp.content('Synthetic draft a', 90), false, 'save-key-vo-000000010'));
insert into ids select 'd', (r->>'package_id')::uuid from saved where name='d1';
select is((select (r->>'is_active') || '/' || (r->>'revision_number') from saved where name='d1'), 'false/1', 'a new offering is saved as a paused draft');
select is(public.vendor_save_package((select id from ids where name='d'), pg_temp.rev((select id from ids where name='d')),
  pg_temp.content('Synthetic draft a', 95), false, 'save-key-vo-000000011')->>'new_version', 'false', 'an unused draft is saved in place');
select is((select price from public.package_tiers where package_id = (select id from ids where name='d')), 95.00, 'with its new price');
select throws_ok($$select public.vendor_set_package_active((select id from ids where name='d'), true, now() - interval '1 year')$$, '40001', null, 'publishing from a stale read is refused');
select is(public.vendor_set_package_active((select id from ids where name='d'), true,
  (select updated_at from public.vendor_packages where id = (select id from ids where name='d')))->>'is_active', 'true', 'the vendor publishes its draft');
select is(public.vendor_set_package_active((select id from ids where name='d'), false,
  (select updated_at from public.vendor_packages where id = (select id from ids where name='d')))->>'is_active', 'false', 'and pauses it');
insert into saved values ('d2', public.vendor_save_package(null, null, pg_temp.content('Synthetic throwaway a', 90), false, 'save-key-vo-000000012'));
select lives_ok($$delete from public.vendor_packages where id = (select (r->>'package_id')::uuid from saved where name='d2')$$, 'an unused paused draft can still be deleted');
-- Guardrail: an out-of-band custom price is saved for Package Reviews and does not match.
select is(public.vendor_save_package(null, null, pg_temp.content('Synthetic high a', 900), true, 'save-key-vo-000000013')->>'needs_review', 'true',
  'an out-of-band price is published into Package Reviews');
select throws_ok($$select public.vendor_save_package(null, null, jsonb_set(pg_temp.content('Synthetic bad a', 90), '{tiers,0,frequency}', '"weekly"'), false, 'save-key-vo-000000014')$$,
  '22023', 'Use only the cadences this service offers in the catalog', 'a cadence the catalog does not offer is refused');
select throws_ok($$select public.vendor_save_package(null, null, pg_temp.content('Synthetic plan a', 90), false, 'short')$$, '22023', 'Invalid save key', 'a save needs a key');
reset role;
select is(pg_temp.matched('33901'), 'Synthetic offerings vendor A:120,Synthetic offerings vendor B:100', 'the reviewed and paused prices do not match');

-- (3) Vendor B cannot touch A; anonymous callers cannot call the commands.
select pg_temp.as_user(3);
set local role authenticated;
select throws_ok($$select public.vendor_save_package((select id from ids where name='p2'), pg_temp.rev((select id from ids where name='p2')),
  pg_temp.content('Hijack', 50), true, 'save-key-vo-000000020')$$, 'P0002', 'Price not found', 'vendor B cannot save over A''s price');
select throws_ok($$select public.vendor_set_package_active((select id from ids where name='p2'), false, now())$$, 'P0002', 'Price not found', 'nor pause it');
select is((select count(*)::int from public.vendor_package_revisions(array[(select id from ids where name='p2')])), 0, 'nor read its version hash');
update public.vendor_packages set is_active = false where id = (select id from ids where name='p2');
reset role;
select is((select is_active from public.vendor_packages where id = (select id from ids where name='p2')), true, 'a direct pause of A''s price by B changes nothing');
set local role anon;
select throws_ok($$select public.vendor_save_package(null, null, '{}'::jsonb, false, 'save-key-vo-000000030')$$, '42501', null, 'anonymous callers cannot save prices');
select throws_ok($$select public.vendor_set_package_active((select id from ids where name='p2'), false, now())$$, '42501', null, 'nor publish or pause them');
reset role;
select pg_temp.as_user(4);
set local role authenticated;
select throws_ok($$select public.vendor_save_package(null, null, pg_temp.content('Synthetic', 90), false, 'save-key-vo-000000031')$$, '42501', 'Vendor access required', 'a homeowner cannot save prices');
reset role;

-- (4) Managed Pricing guardrail on the server.
insert into public.pricing_templates(id,service_id,name,is_active) values ('c1043000-0000-4000-8000-000000000001','synthetic-vo-svc','Synthetic template',true);
insert into public.pricing_template_tiers(id,template_id,name,min_price,max_price,suggested_price,sort_order)
  values ('c1043100-0000-4000-8000-000000000001','c1043000-0000-4000-8000-000000000001','Standard',50,150,100,0);
select pg_temp.as_user(2);
set local role authenticated;
insert into saved values ('m1', public.vendor_save_package(null, null, jsonb_build_object('service_id','synthetic-vo-svc','template_id','c1043000-0000-4000-8000-000000000001',
  'package', jsonb_build_object('name','Synthetic managed a','pricing_mode','fixed','default_frequency','one-time'),
  'tiers', jsonb_build_array(jsonb_build_object('template_tier_id','c1043100-0000-4000-8000-000000000001','name','Standard','price',500,'frequency','one-time'))),
  true, 'save-key-vo-000000040'));
select is((select r->>'needs_review' from saved where name='m1'), 'true', 'an out-of-range Managed Pricing level goes to Package Reviews');
update public.vendor_packages set needs_review = false where id = (select (r->>'package_id')::uuid from saved where name='m1');
select is((select needs_review from public.vendor_packages where id = (select (r->>'package_id')::uuid from saved where name='m1')), true,
  'the vendor cannot clear the Managed Pricing review flag');
select throws_ok($$select public.vendor_save_package(null, null, jsonb_build_object('service_id','synthetic-vo-svc','template_id','c1043000-0000-4000-8000-000000000001',
  'package', jsonb_build_object('name','Synthetic managed b','pricing_mode','fixed','default_frequency','one-time'),
  'tiers', jsonb_build_array(jsonb_build_object('template_tier_id','c1041000-0000-4000-8000-00000000000a','name','Standard','price',100,'frequency','one-time'))),
  false, 'save-key-vo-000000041')$$, '22023', 'A price level does not belong to this pricing template', 'a level must belong to its template');
reset role;

-- (5) Legacy promotions and service ZIP codes are operator-managed.
select pg_temp.as_user(2);
set local role authenticated;
select throws_ok($$insert into public.package_promotions(package_id,promotion_type,percent_off,label,starts_at,ends_at,is_enabled)
  values ((select id from ids where name='p2'),'percent_off',50,'Half off',now() - interval '1 hour',now() + interval '1 day',true)$$, '42501', null,
  'vendor: a legacy promotion cannot be created');
select throws_ok($$insert into public.contractor_service_zips(contractor_id,zip_code) values (pg_temp.vendor('a'),'33903')$$, '42501', null,
  'vendor: its service ZIP codes cannot be added');
delete from public.contractor_service_zips where contractor_id = pg_temp.vendor('a');
select throws_ok($$select policy_notes from public.vendor_packages limit 1$$, '42501', null, 'vendor: internal notes stay unreadable');
reset role;
select is((select count(*)::int from public.contractor_service_zips where contractor_id = pg_temp.vendor('a')), 2, 'vendor: nor removed');
select is(pg_temp.matched('33901'), 'Synthetic offerings vendor A:120,Synthetic offerings vendor B:100', 'no promotion changes the matched price');
select pg_temp.as_user(1);
set local role authenticated;
select lives_ok($$insert into public.contractor_service_zips(contractor_id,zip_code) values (pg_temp.vendor('a'),'33903')$$, 'operator: adds a service ZIP code');
select throws_ok($$insert into public.contractor_service_zips(contractor_id,zip_code) values (pg_temp.vendor('a'),'3390')$$, '23514', null, 'a ZIP code must be five digits');
select lives_ok($$delete from public.contractor_service_zips where contractor_id = pg_temp.vendor('a') and zip_code = '33903'$$, 'operator: removes it');
reset role;
select is(pg_temp.matched('33903'), '', 'a covered ZIP the vendor does not serve matches no one');
select is(pg_temp.matched('00104'), '', 'a vendor ZIP outside active coverage matches no one');

-- Archived history stays read-only through the commands too.
select pg_temp.as_user(1);
set local role authenticated;
select lives_ok($$select public.admin_archive_package((select id from ids where name='p'),
  (select updated_at from public.vendor_packages where id = (select id from ids where name='p')), 'Synthetic replaced')$$, 'operator: archives the paused, in-use version');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select throws_ok($$select public.vendor_set_package_active((select id from ids where name='p'), true, now())$$, '55000', null, 'an archived version cannot be published');
reset role;
select is(pg_temp.binding(), 'true/true/true/100.00', 'the archived version still carries the request''s binding and terms');

select * from finish();
rollback;
