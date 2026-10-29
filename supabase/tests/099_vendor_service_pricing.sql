-- TRACE-129 (DEC-2026-051, 20261030001000). Synthetic fixtures only.
-- (1) The four pest services are in the catalog as Custom Quote, shown, with zero reference prices.
-- (2) A vendor's price is its own package: an operator offers a service as Custom Quote for one
--     vendor through the existing draft-and-publish commands. Nothing is sent for approval and no
--     email notice is claimed; another vendor's price and the catalog row are unchanged.
-- (3) Saving a vendor's services writes the services column only; visibility and marketing stay.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- (1) Seeded services.
select is((select count(*)::int from public.services_catalog
  where id in ('termite-control','rodent-control','mosquito-control','flea-tick-control')
    and pricing_mode = 'custom_quote' and is_active and category_id = 'specialty'
    and monthly_price = 0 and one_time_price = 0 and weekly_price is null and default_deposit_amount is null), 4,
  'Termite, Rodent, Mosquito and Flea & Tick Control are shown Custom Quote services with zero reference prices');
select is((select count(*)::int from public.services_catalog where lower(name) in
  ('termite control','rodent control','mosquito control','flea & tick control')), 4, 'each is in the catalog once');
select is((select default_frequency from public.services_catalog where id = 'termite-control'), 'one-time',
  'a quote request defaults to one visit');

-- 1 operator; 2 vendor bound to provider 1; provider 2 has a live fixed price for the same service.
insert into auth.users(id,email,email_confirmed_at) values
 ('b9910000-0000-4000-8000-000000000001','vsp-operator@example.invalid',now()),
 ('b9910000-0000-4000-8000-000000000002','vsp-vendor@example.invalid',now());
delete from public.user_roles where user_id = 'b9910000-0000-4000-8000-000000000002';
insert into public.user_roles(user_id,role) values
 ('b9910000-0000-4000-8000-000000000001','admin'),
 ('b9910000-0000-4000-8000-000000000002','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id,services) values
 ('b9920000-0000-4000-8000-000000000001','Synthetic hidden pest vendor',false,false,'b9910000-0000-4000-8000-000000000002','{}'),
 ('b9920000-0000-4000-8000-000000000002','Synthetic priced pest vendor',true,true,null,'{termite-control}');
insert into public.service_categories(id,name) values ('synthetic-vsp-cat','Synthetic vendor pricing category');
insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,pricing_mode,default_frequency,available_frequencies,is_active) values
 ('synthetic-vsp-svc','Synthetic fixed-default service','synthetic-vsp-cat',110,55,'fixed','monthly','{one-time,monthly}',true);

create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9910000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.vendor(p_n integer) returns uuid language sql as $$ select ('b9920000-0000-4000-8000-00000000000'||p_n)::uuid $$;
create function pg_temp.stamp(p_draft uuid) returns timestamptz language sql security definer as $$
 select updated_at from private.operator_package_drafts where id = p_draft $$;
create function pg_temp.draft_state(p_draft uuid) returns text language sql security definer as $$
 select status || '/' || approval_state || '/' || (sent_at is null)::text from private.operator_package_drafts where id = p_draft $$;
create function pg_temp.email_claims(p_vendor uuid) returns integer language sql security definer as $$
 select count(*)::int from private.package_draft_email_notices n
  join private.operator_package_drafts d on d.id = n.draft_id where d.contractor_id = p_vendor $$;
create function pg_temp.quote_content(p_name text) returns jsonb language sql as $$
 select jsonb_build_object('name',p_name,'description',null,'pricing_mode','custom_quote','deposit_amount',null,
   'included_scope','[]'::jsonb,'policy_notes',null,'questions','[]'::jsonb,'tiers','[]'::jsonb,'addons','[]'::jsonb) $$;
create temp table ids(name text primary key, id uuid);
grant all on ids to authenticated;
create temp table results(name text primary key, r jsonb);
grant all on results to authenticated;

select pg_temp.as_user('1');
set local role authenticated;
-- Vendor 2's own fixed price for the service whose catalog default is fixed $55/$110.
insert into ids values ('fixed', (public.admin_save_package_draft(null, null, pg_temp.vendor(2), 'synthetic-vsp-svc', 'Synthetic fixed plan',
  null, jsonb_build_array(jsonb_build_object('frequency','monthly','price',72)))->>'id')::uuid);
insert into results values ('fixed', public.admin_publish_package_draft((select id from ids where name='fixed'),
  pg_temp.stamp((select id from ids where name='fixed')), 'Synthetic agreed rate'));

-- (3) "Save services" on the hidden vendor: services column only.
update public.contractors set services = '{synthetic-vsp-svc,termite-control}' where id = pg_temp.vendor(1);
reset role;
select is((select is_active::text || '/' || marketing_enabled::text from public.contractors where id = pg_temp.vendor(1)), 'false/false',
  'saving services leaves a hidden vendor hidden and marketing off');

-- (2) Custom Quote for vendor 1, on both services.
select pg_temp.as_user('1');
set local role authenticated;
insert into ids select 'quote-' || s, (public.admin_save_package_draft_content(null, null, pg_temp.vendor(1), s, null,
  pg_temp.quote_content(case s when 'termite-control' then 'Termite Control' else 'Synthetic fixed-default service' end))->>'id')::uuid
  from unnest(array['synthetic-vsp-svc','termite-control']) s;
insert into results select name, public.admin_publish_package_draft(id, pg_temp.stamp(id), 'Synthetic onboarding: priced per job')
  from ids where name like 'quote-%';
reset role;

select is((select count(*)::int from public.vendor_packages p where p.contractor_id = pg_temp.vendor(1) and p.is_active
  and p.pricing_mode = 'custom_quote' and not p.needs_review), 2, 'vendor 1 offers both services as its own Custom Quote');
select is((select count(*)::int from public.package_tiers t join public.vendor_packages p on p.id = t.package_id
  where p.contractor_id = pg_temp.vendor(1)), 0, 'a Custom Quote has no price levels: nothing is charged without a quote');
select is((select count(*)::int from ids i where i.name like 'quote-%' and pg_temp.draft_state(i.id) = 'published/draft/true'), 2,
  'each was published without being sent for approval');
select is(pg_temp.email_claims(pg_temp.vendor(1)), 0, 'no email notice was claimed for the vendor');
select is((select count(*)::int from public.notifications where user_id = 'b9910000-0000-4000-8000-000000000002'
  and type = 'pricing' and body like '%Synthetic onboarding: priced per job'), 2, 'the linked vendor gets the inbox notice with the reason');

select is((select string_agg(t.frequency || '=' || t.price::text, ',') from public.package_tiers t
  join public.vendor_packages p on p.id = t.package_id where p.contractor_id = pg_temp.vendor(2) and p.is_active), 'monthly=72',
  'another vendor''s own price for the same service is unchanged');
select is((select pricing_mode || '/' || monthly_price::text || '/' || one_time_price::text from public.services_catalog where id = 'synthetic-vsp-svc'),
  'fixed/55/110', 'the catalog default is unchanged');
select is((select is_active::text || '/' || marketing_enabled::text from public.contractors where id = pg_temp.vendor(1)), 'false/false',
  'publishing a price does not change visibility or marketing');

select * from finish();
rollback;
