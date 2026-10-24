-- TRACE-120 (DEC-2026-046, 20261024001000). Synthetic fixtures only: an operator publishes a
-- draft price whatever the vendor's approval state (never sent, sent, changes requested,
-- approved, unlinked vendor, a correction of a live package). The vendor's approval is
-- recorded and reported, not required; the other publication rules still hold.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator; 2 vendor bound to provider 1; provider 2 has no account.
insert into auth.users(id,email,email_confirmed_at) values
 ('b9110000-0000-4000-8000-000000000001','publish-operator@example.invalid',now()),
 ('b9110000-0000-4000-8000-000000000002','publish-vendor@example.invalid',now());
delete from public.user_roles where user_id = 'b9110000-0000-4000-8000-000000000002';
insert into public.user_roles(user_id,role) values
 ('b9110000-0000-4000-8000-000000000001','admin'),
 ('b9110000-0000-4000-8000-000000000002','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b9120000-0000-4000-8000-000000000001','Synthetic publish vendor',true,true,'b9110000-0000-4000-8000-000000000002'),
 ('b9120000-0000-4000-8000-000000000002','Synthetic unlinked publish vendor',true,true,null);
insert into public.service_categories(id,name) values ('synthetic-publish-cat','Synthetic publish category');
insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,default_frequency,available_frequencies,is_active) values
 ('synthetic-publish-svc','Synthetic publish service','synthetic-publish-cat',100,60,'monthly','{one-time,monthly}',true);

create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9110000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.vendor(p_n integer) returns uuid language sql as $$ select ('b9120000-0000-4000-8000-00000000000'||p_n)::uuid $$;
create function pg_temp.stamp(p_draft uuid) returns timestamptz language sql security definer as $$
 select updated_at from private.operator_package_drafts where id = p_draft $$;
create function pg_temp.rev(p_draft uuid) returns text language sql security definer as $$
 select content_hash from private.operator_package_drafts where id = p_draft $$;
create function pg_temp.save(p_vendor integer, p_name text, p_price numeric default 60) returns uuid language sql as $$
 select (public.admin_save_package_draft(null, null, pg_temp.vendor(p_vendor), 'synthetic-publish-svc', p_name, 'Synthetic scope',
   jsonb_build_array(jsonb_build_object('frequency','monthly','price',p_price)))->>'id')::uuid $$;
create function pg_temp.publish(p_draft uuid, p_reason text default 'Synthetic agreed rate') returns jsonb language sql as $$
 select public.admin_publish_package_draft(p_draft, pg_temp.stamp(p_draft), p_reason) $$;
create function pg_temp.published_event(p_draft uuid) returns jsonb language sql security definer as $$
 select changes from private.package_draft_events where draft_id = p_draft and kind = 'published' $$;
create function pg_temp.notice(p_package uuid) returns text language sql security definer as $$
 select n.title from public.notifications n join public.vendor_packages p on p.name || ': Synthetic agreed rate' = n.body
  where p.id = p_package and n.user_id = 'b9110000-0000-4000-8000-000000000002' and n.type = 'pricing' $$;
create temp table ids(name text primary key, id uuid);
grant all on ids to authenticated;
create temp table results(name text primary key, r jsonb);
grant all on results to authenticated;

select pg_temp.as_user('1');
set local role authenticated;
insert into ids values ('never', pg_temp.save(1, 'Synthetic never sent')), ('sent', pg_temp.save(1, 'Synthetic sent')),
  ('changes', pg_temp.save(1, 'Synthetic changes requested')), ('approved', pg_temp.save(1, 'Synthetic approved')),
  ('unlinked', pg_temp.save(2, 'Synthetic unlinked'));
select lives_ok($$select public.admin_send_package_draft(id, pg_temp.rev(id)) from ids where name in ('sent','changes','approved')$$,
 'three drafts are sent to the vendor');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select lives_ok($$select public.vendor_request_package_changes((select id from ids where name='changes'),
  pg_temp.rev((select id from ids where name='changes')), 'Synthetic: lower the price')$$, 'the vendor asks for changes on one');
select lives_ok($$select public.vendor_approve_package_draft((select id from ids where name='approved'),
  pg_temp.rev((select id from ids where name='approved')))$$, 'and approves another');
select throws_ok($$select pg_temp.publish((select id from ids where name='sent'))$$, '42501', 'Onboarding operator required',
 'a vendor still cannot publish');
reset role;

-- Rules that still hold.
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select pg_temp.publish((select id from ids where name='never'), ' ')$$, 'P0001', 'Publish reason required',
 'a reason is still required');
select throws_ok($$select public.admin_publish_package_draft((select id from ids where name='never'), '2000-01-01', 'Synthetic')$$,
 '40001', 'Draft changed since it was read; reload before publishing', 'a stale read is still refused');
reset role;

-- Every approval state publishes.
select pg_temp.as_user('1');
set local role authenticated;
insert into results select name, pg_temp.publish(id) from ids;
select is((select count(*)::int from results where r->>'package_id' is not null), 5,
 'never sent, sent, changes requested, approved and unlinked drafts all publish');
select is((select jsonb_object_agg(name, (r->>'vendor_approved')::boolean) from results),
 '{"never":false,"sent":false,"changes":false,"approved":true,"unlinked":false}'::jsonb,
 'the result says whether the vendor had approved the published revision');
select is((select (r->>'vendor_notified')::boolean from results where name='unlinked'), false, 'no account, no notice');
select is((select (r->>'vendor_notified')::boolean from results where name='sent'), true, 'the bound vendor is notified');
select is(public.admin_package_drafts(pg_temp.vendor(1)), '[]'::jsonb, 'published drafts leave the open list');
reset role;

select is((select count(*)::int from public.vendor_packages p join results x on (x.r->>'package_id')::uuid = p.id where p.is_active), 5,
 'the packages are live');
select is((select jsonb_object_agg(name, (pg_temp.published_event(i.id))->>'vendor_approved') from ids i),
 '{"never":"false","sent":"false","changes":"false","approved":"true","unlinked":"false"}'::jsonb,
 'the published event records whether the vendor approved');
select is(pg_temp.notice((select (r->>'package_id')::uuid from results where name='sent')), 'Mercurius published a price for you',
 'an unapproved price is announced as published by Mercurius');
select is(pg_temp.notice((select (r->>'package_id')::uuid from results where name='approved')), 'Your approved price is live',
 'an approved price is announced as the vendor''s approved price');
select is(private.package_approval_evidence((select (r->>'package_id')::uuid from results where name='changes'))->>'status',
 'operator_published', 'approval evidence does not claim the vendor approved');
select is(private.package_approval_evidence((select (r->>'package_id')::uuid from results where name='approved'))->>'status',
 'vendor_approved', 'a vendor-approved revision is still reported as such');

-- After publication the vendor's pending decision is closed.
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select public.vendor_approve_package_draft((select id from ids where name='sent'), pg_temp.rev((select id from ids where name='sent')))$$,
 'P0001', 'This price was already published or withdrawn', 'a published draft can no longer be approved');
reset role;

-- A correction of a live package publishes without approval as its next revision.
insert into public.service_requests(id,customer_id,service_type,address,city,state,zip_code,frequency,package_id,total_amount)
 values ('b9150000-0000-4000-8000-000000000001','b9110000-0000-4000-8000-000000000002','Synthetic','1 Synthetic Way','Synthetic','FL','00091',
   'monthly',(select (r->>'package_id')::uuid from results where name='never'),60);
create function pg_temp.pkg_stamp(p_package uuid) returns timestamptz language sql security definer as $$
 select updated_at from public.vendor_packages where id = p_package $$;
create function pg_temp.tier_of(p_package uuid) returns text language sql security definer as $$
 select id::text from public.package_tiers where package_id = p_package order by sort_order, id limit 1 $$;
select pg_temp.as_user('1');
set local role authenticated;
insert into ids select 'fix', (public.admin_draft_from_package(p.id, pg_temp.pkg_stamp(p.id),
   jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object('id', pg_temp.tier_of(p.id), 'from', 60, 'price', 55))),
   'Synthetic correction')->'draft'->>'id')::uuid
  from (select (r->>'package_id')::uuid id from results where name='never') p;
insert into results select 'fix', pg_temp.publish((select id from ids where name='fix'), 'Synthetic correction');
reset role;
select is((select row((r->>'vendor_approved')::boolean, (r->>'revision_number')::int,
   (r->>'replaced_package_id')::uuid = (select (x.r->>'package_id')::uuid from results x where x.name='never'))::text from results where name='fix'),
 row(false, 2, true)::text, 'the correction is revision 2 and replaces the live package without approval');
select is((select price from public.package_tiers where package_id=(select (r->>'package_id')::uuid from results where name='fix')), 55::numeric,
 'the corrected price is live');
select is((select is_active from public.vendor_packages where id=(select (r->>'package_id')::uuid from results where name='never')), false,
 'the previous revision is paused');
select is((select total_amount from public.service_requests where id='b9150000-0000-4000-8000-000000000001'), 60.00,
 'an earlier booking keeps its price');

select * from finish();
rollback;
