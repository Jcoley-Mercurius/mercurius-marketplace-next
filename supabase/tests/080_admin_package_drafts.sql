begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-110, DEC-2026-035 (20261016002000). Synthetic fixtures only: "every two months" is a
-- cadence, and an operator drafts a price for a specific vendor, then publishes it with a
-- reason. A draft is private until published; publishing creates an ordinary custom fixed
-- package, records the prices in the TRACE-109 history and notifies the linked vendor.
insert into auth.users(id,email,email_confirmed_at) values
 ('b8010000-0000-4000-8000-000000000001','draft-operator@example.invalid',now()),
 ('b8010000-0000-4000-8000-000000000002','draft-vendor@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b8010000-0000-4000-8000-000000000001','admin'),
 ('b8010000-0000-4000-8000-000000000002','vendor');
-- 1 linked to vendor 2, 2 has no account.
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b8020000-0000-4000-8000-000000000001','Synthetic draft vendor',true,true,'b8010000-0000-4000-8000-000000000002'),
 ('b8020000-0000-4000-8000-000000000002','Synthetic unlinked draft vendor',true,true,null);
insert into public.service_categories(id,name) values ('synthetic-draft-cat','Synthetic draft category');
-- svc offers monthly, every two months and one-time (default every two months); open has
-- no cadence list (every cadence); closed is inactive.
insert into public.services_catalog(id,name,category_id,monthly_price,one_time_price,default_frequency,available_frequencies,is_active) values
 ('synthetic-draft-svc','Synthetic draft service','synthetic-draft-cat',40,100,'every-two-months','{monthly,every-two-months,one-time}',true),
 ('synthetic-draft-open','Synthetic open service','synthetic-draft-cat',40,100,'monthly','{}',true),
 ('synthetic-draft-closed','Synthetic closed service','synthetic-draft-cat',40,100,'monthly','{monthly}',false);

create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8010000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.vendor(p_n integer) returns uuid language sql as $$
 select ('b8020000-0000-4000-8000-00000000000'||p_n)::uuid $$;
create function pg_temp.save(p_vendor integer, p_service text, p_prices jsonb, p_name text default 'Synthetic draft package')
returns jsonb language sql as $$
 select public.admin_save_package_draft(null, null, pg_temp.vendor(p_vendor), p_service, p_name, 'Synthetic description', p_prices) $$;
create function pg_temp.price(p_frequency text, p_price numeric) returns jsonb language sql as $$
 select jsonb_build_object('frequency', p_frequency, 'price', p_price) $$;
create function pg_temp.stamp(p_draft uuid) returns timestamptz language sql security definer as $$
 select updated_at from private.operator_package_drafts where id = p_draft $$;
create function pg_temp.publish(p_draft uuid, p_reason text default 'Synthetic agreed rate') returns jsonb language sql as $$
 select public.admin_publish_package_draft(p_draft, pg_temp.stamp(p_draft), p_reason) $$;
create temp table ids(name text primary key, id uuid);
grant all on ids to authenticated;

-- Cadence: every two months is accepted wherever cadences are checked.
select ok(pg_get_constraintdef((select oid from pg_constraint where conname='package_tiers_frequency_check')) like '%every-two-months%',
 'package tiers accept every two months');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname='vendor_packages_default_frequency_check')) like '%every-two-months%',
 'packages accept every two months as their cadence');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname='money_recurring_occurrence_identities_frequency_check')) like '%every-two-months%',
 'recurring visit identities accept every two months');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname='package_tiers_frequency_check')) like '%bi-monthly%',
 'every two weeks is still a cadence');
select ok((select prosrc from pg_proc where oid='public.preview_service_request_selections(jsonb)'::regprocedure)
   like '%''monthly'', ''every-two-months'', ''quarterly''%', 'request preview accepts every two months');
select ok((select prosrc from pg_proc where oid='private.submit_service_requests_core(text,jsonb)'::regprocedure)
   like '%''monthly'', ''every-two-months'', ''quarterly''%', 'request submission accepts every two months');
select throws_ok($$insert into public.package_tiers(package_id,name,price,frequency)
   values (gen_random_uuid(),'x',1,'every-three-months')$$, '23514', null, 'an unknown cadence is still refused');

-- Grants.
select ok(not has_function_privilege('anon','public.admin_save_package_draft(uuid,timestamptz,uuid,text,text,text,jsonb)','execute'),
 'anonymous callers cannot save drafts');
select ok(not has_function_privilege('anon','public.admin_publish_package_draft(uuid,timestamptz,text)','execute'),
 'anonymous callers cannot publish drafts');
select ok(not has_table_privilege('authenticated','private.operator_package_drafts','select'),
 'signed-in users cannot read drafts directly');

-- A vendor cannot use the operator commands.
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select pg_temp.save(1,'synthetic-draft-svc',jsonb_build_array(pg_temp.price('monthly',40)))$$,
 '42501','Onboarding operator required','a vendor cannot draft');
select throws_ok($$select public.admin_package_drafts(null)$$,'42501','Onboarding operator required','a vendor cannot list drafts');
reset role;

select pg_temp.as_user('1');
set local role authenticated;

-- Draft validation.
select throws_ok($$select pg_temp.save(1,'synthetic-draft-svc','[]'::jsonb)$$,'P0001','Enter at least one price','a price is required');
select throws_ok($$select pg_temp.save(1,'synthetic-draft-svc',jsonb_build_array(pg_temp.price('monthly',40),pg_temp.price('monthly',45)))$$,
 'P0001','Enter one price per cadence','one price per cadence');
select throws_ok($$select pg_temp.save(1,'synthetic-draft-svc',jsonb_build_array(pg_temp.price('fortnightly',40)))$$,
 'P0001','Unknown cadence','an unknown cadence is refused');
select throws_ok($$select pg_temp.save(1,'synthetic-draft-svc',jsonb_build_array(pg_temp.price('quarterly',40)))$$,
 'P0001','Quarterly is not offered for this service in the catalog','a cadence the catalog does not offer is refused');
select throws_ok($$select pg_temp.save(1,'synthetic-draft-svc',jsonb_build_array(pg_temp.price('monthly',40.005)))$$,
 'P0001','Each price must be a positive amount in whole cents','prices are whole cents');
select throws_ok($$select pg_temp.save(1,'synthetic-draft-svc',jsonb_build_array(pg_temp.price('monthly',0)))$$,
 'P0001','Each price must be a positive amount in whole cents','prices are positive');
select throws_ok($$select pg_temp.save(1,'synthetic-draft-closed',jsonb_build_array(pg_temp.price('monthly',40)))$$,
 'P0001','Choose an active catalog service','an inactive service is refused');
select throws_ok($$select pg_temp.save(1,'synthetic-draft-svc',jsonb_build_array(pg_temp.price('monthly',40)),'   ')$$,
 'P0001','Package name required','a name is required');
select throws_ok($$select public.admin_save_package_draft(null,null,gen_random_uuid(),'synthetic-draft-svc','x',null,
   jsonb_build_array(pg_temp.price('monthly',40)))$$,'P0002','Vendor not found','an unknown vendor is refused');

-- A draft is saved in cadence order and stays private.
insert into ids select 'a', (pg_temp.save(1,'synthetic-draft-svc',
  jsonb_build_array(pg_temp.price('every-two-months',70),pg_temp.price('monthly',40)))->>'id')::uuid;
select is((public.admin_package_drafts(pg_temp.vendor(1))->0->'prices'),
 jsonb_build_array(pg_temp.price('monthly',40),pg_temp.price('every-two-months',70)),'prices are saved in cadence order');
select is(public.admin_package_drafts(pg_temp.vendor(1))->0->>'created_by_email','draft-operator@example.invalid',
 'the draft lists who started it');
select is(jsonb_array_length(public.admin_package_drafts(null)),1,'the all-vendors list includes it');
reset role;
select is((select count(*)::int from public.vendor_packages where contractor_id=pg_temp.vendor(1)),0,
 'a draft creates no vendor package');
select is((select count(*)::int from public.notifications where user_id='b8010000-0000-4000-8000-000000000002'),0,
 'saving a draft notifies no one');

-- Editing: stale reads and moving vendors are refused.
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select public.admin_save_package_draft((select id from ids where name='a'),'2000-01-01',pg_temp.vendor(1),
   'synthetic-draft-svc','x',null,jsonb_build_array(pg_temp.price('monthly',40)))$$,
 '40001','Draft changed since it was read; reload before saving','a stale edit is refused');
select throws_ok($$select public.admin_save_package_draft((select id from ids where name='a'),pg_temp.stamp((select id from ids where name='a')),
   pg_temp.vendor(2),'synthetic-draft-svc','x',null,jsonb_build_array(pg_temp.price('monthly',40)))$$,
 'P0001','A draft stays with the vendor it was started for','a draft cannot move to another vendor');
select is(public.admin_save_package_draft((select id from ids where name='a'),pg_temp.stamp((select id from ids where name='a')),
   pg_temp.vendor(1),'synthetic-draft-svc','Synthetic lawn plan','Synthetic description',
   jsonb_build_array(pg_temp.price('monthly',45),pg_temp.price('every-two-months',75)))->'prices',
 jsonb_build_array(pg_temp.price('monthly',45),pg_temp.price('every-two-months',75)),'an edit replaces the prices');

-- Publishing.
select throws_ok($$select pg_temp.publish((select id from ids where name='a'),'  ')$$,'P0001','Publish reason required','a reason is required');
select throws_ok($$select pg_temp.publish((select id from ids where name='a'),repeat('x',501))$$,'P0001','Publish reason too long',
 'the reason is at most 500 characters');
select throws_ok($$select public.admin_publish_package_draft((select id from ids where name='a'),'2000-01-01','Synthetic')$$,
 '40001','Draft changed since it was read; reload before publishing','a stale publish is refused');
insert into ids select 'pkg', (pg_temp.publish((select id from ids where name='a'))->>'package_id')::uuid;
select is(public.admin_package_drafts(pg_temp.vendor(1)),'[]'::jsonb,'a published draft leaves the list');
select throws_ok($$select pg_temp.publish((select id from ids where name='a'))$$,'P0001',
 'This draft was already published or discarded','a draft publishes once');
reset role;

select is((select row(name,pricing_mode,default_frequency,is_active,needs_review,template_id is null)::text
  from public.vendor_packages where id=(select id from ids where name='pkg')),
 row('Synthetic lawn plan','fixed','every-two-months',true,false,true)::text,
 'publishing creates an active custom fixed package at the catalog default cadence');
select is((select array_agg(row(name,price,frequency,sort_order)::text order by sort_order) from public.package_tiers
  where package_id=(select id from ids where name='pkg')),
 array[row('Monthly',45::numeric,'monthly',0)::text,row('Every two months',75::numeric,'every-two-months',1)::text],
 'one price per cadence, named like the vendor editor names them');
select is((select (changes->1) - 'id' from private.vendor_package_price_corrections where package_id=(select id from ids where name='pkg')),
 jsonb_build_object('kind','tier','name','Every two months','frequency','every-two-months','from',null,'to',75),
 'the new prices are recorded in the price history');
select is((select reason from private.vendor_package_price_corrections where package_id=(select id from ids where name='pkg')),
 'Synthetic agreed rate','the history keeps the reason');
select is((select row(title,body,link)::text from public.notifications where user_id='b8010000-0000-4000-8000-000000000002' and type='pricing'),
 row('Mercurius added a price','Synthetic lawn plan: Synthetic agreed rate','/vendor/packages')::text,
 'the linked vendor is notified with the reason');

-- The vendor reads it like a correction: what and why, not who.
select pg_temp.as_user('2');
set local role authenticated;
select is(public.vendor_my_package_price_corrections()->0->>'reason','Synthetic agreed rate','the vendor sees why');
select ok(not (public.vendor_my_package_price_corrections()->0 ? 'actor_email'),'the vendor does not see who');
select is((select count(*)::int from public.vendor_packages where id=(select id from ids where name='pkg')),1,
 'the published package is the vendor''s own');
reset role;

-- Duplicates: an active package at the same cadence refuses; another cadence does not.
select pg_temp.as_user('1');
set local role authenticated;
insert into ids select 'dup', (pg_temp.save(1,'synthetic-draft-svc',
  jsonb_build_array(pg_temp.price('monthly',50),pg_temp.price('one-time',100)))->>'id')::uuid;
select throws_ok($$select pg_temp.publish((select id from ids where name='dup'))$$,'23505',
 'This vendor already has an active Monthly price for this service; correct that package instead',
 'a second active price at the same cadence is refused');
insert into ids select 'other', (pg_temp.save(1,'synthetic-draft-svc',jsonb_build_array(pg_temp.price('one-time',100)))->>'id')::uuid;
select ok((pg_temp.publish((select id from ids where name='other'))->>'package_id') is not null,
 'another cadence for the same service publishes');

-- Out-of-band prices wait in Package Reviews; publishing is not an approval.
insert into ids select 'band', (pg_temp.save(1,'synthetic-draft-open',jsonb_build_array(pg_temp.price('quarterly',5000)))->>'id')::uuid;
select is((pg_temp.publish((select id from ids where name='band'))->>'needs_review')::boolean,true,
 'a price outside the guardrail band is flagged for review');
-- The monthly reference (40) bands every two months at 10 to 160; no account, no notice.
insert into ids select 'edge', (pg_temp.save(2,'synthetic-draft-svc',jsonb_build_array(pg_temp.price('every-two-months',161)))->>'id')::uuid;
select is(pg_temp.publish((select id from ids where name='edge')) - 'package_id',
 jsonb_build_object('needs_review',true,'vendor_notified',false),
 'every two months is banded by the monthly reference; an unlinked vendor is not notified');
insert into ids select 'in', (pg_temp.save(2,'synthetic-draft-open',jsonb_build_array(pg_temp.price('every-two-months',160)))->>'id')::uuid;
select is((pg_temp.publish((select id from ids where name='in'))->>'needs_review')::boolean,false,
 'every two months at the top of the band is not flagged');

-- Discarding.
insert into ids select 'drop', (pg_temp.save(2,'synthetic-draft-svc',jsonb_build_array(pg_temp.price('monthly',40)))->>'id')::uuid;
select throws_ok($$select public.admin_discard_package_draft((select id from ids where name='drop'),'2000-01-01')$$,
 '40001','Draft changed since it was read; reload before discarding','a stale discard is refused');
select is(public.admin_discard_package_draft((select id from ids where name='drop'),pg_temp.stamp((select id from ids where name='drop')))->>'status',
 'discarded','an operator discards a draft');
select is(jsonb_array_length(public.admin_package_drafts(pg_temp.vendor(2))),0,'a discarded draft leaves the list');
select throws_ok($$select pg_temp.publish((select id from ids where name='drop'))$$,'P0001',
 'This draft was already published or discarded','a discarded draft cannot be published');
reset role;

select * from finish();
rollback;
