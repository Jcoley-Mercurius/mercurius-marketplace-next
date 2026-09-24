begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-086 synthetic fixtures only. No anonymous or signed-in client can insert a
-- vendor_applications row directly; the application route's service key still can, and its
-- insert still notifies admins and records the intake version. No real applicant, provider
-- or account is represented.
insert into auth.users(id,email,email_confirmed_at) values
 ('b9a00000-0000-4000-8000-000000000001','applicant-insert-operator@example.invalid',now()),
 ('b9a00000-0000-4000-8000-000000000002','applicant-insert-member@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b9a00000-0000-4000-8000-000000000001','admin');

-- A row the old policy accepted: pending, uninvited, every checked field within its limits.
create function pg_temp.direct_insert(p_id uuid) returns void language sql as $$
 insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,years_experience,services,status,document_urls)
 values (p_id,'Synthetic direct applicant','Test','Applicant','applicant-insert@example.invalid','5550000000',1,array['synthetic'],'pending',
  array[p_id::text||'/license/synthetic-license.pdf']) $$;
create function pg_temp.as_user(p_user uuid) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',p_user)::text,true) $$;
create function pg_temp.as_anon() returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"anon"}',true) $$;

-- Structure.
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='vendor_applications'
 and policyname='Anyone can submit vendor application'),'The applicant insert policy is removed');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='vendor_applications'
 and cmd in ('INSERT','ALL')),'No policy permits a client to insert an application');
select ok(not has_table_privilege('anon','public.vendor_applications','INSERT'),'An anonymous caller holds no INSERT on applications');
select ok(not has_any_column_privilege('anon','public.vendor_applications','INSERT'),'Nor INSERT on any application column');
select ok(not has_table_privilege('authenticated','public.vendor_applications','INSERT'),'A signed-in caller holds no INSERT on applications');
select ok(not has_any_column_privilege('authenticated','public.vendor_applications','INSERT'),'Nor INSERT on any application column');
select ok(not has_table_privilege('anon','public.vendor_applications','SELECT'),'An anonymous caller still cannot read applications');
select ok(has_table_privilege('authenticated','public.vendor_applications','SELECT'),'A signed-in caller keeps SELECT, filtered by the admin read policy');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='vendor_applications'
 and policyname='Admins can view all applications' and cmd='SELECT'),'The admin read policy is unchanged');
select ok(has_table_privilege('service_role','public.vendor_applications','INSERT'),'The service key used by the application route keeps INSERT');
select ok(exists(select 1 from pg_trigger where tgrelid='public.vendor_applications'::regclass
 and tgname='trg_notify_admins_new_vendor_application' and tgenabled<>'D'),'The admin notification trigger is unchanged');
select ok(exists(select 1 from pg_trigger where tgrelid='public.vendor_applications'::regclass
 and tgname='vendor_version_intake' and tgenabled<>'D'),'The intake version trigger is unchanged');
select ok(has_table_privilege('anon','public.contact_submissions','INSERT'),'The public contact form keeps its insert grant');

-- No client can insert a row the old policy accepted.
select pg_temp.as_anon();
set local role anon;
select throws_ok($$select pg_temp.direct_insert('b9b00000-0000-4000-8000-000000000001')$$,
 '42501',null,'An anonymous caller cannot insert an application directly');
reset role;
select pg_temp.as_user('b9a00000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select pg_temp.direct_insert('b9b00000-0000-4000-8000-000000000002')$$,
 '42501',null,'A signed-in non-admin cannot insert an application directly');
reset role;
select pg_temp.as_user('b9a00000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select pg_temp.direct_insert('b9b00000-0000-4000-8000-000000000003')$$,
 '42501',null,'A signed-in admin cannot insert an application directly');
reset role;
select is((select count(*) from public.vendor_applications where id::text like 'b9b00000-%'),0::bigint,'No application was created');
select is((select count(*) from public.notifications where user_id='b9a00000-0000-4000-8000-000000000001'
 and type='vendor_application'),0::bigint,'And no admin was notified');

-- The route's service-key insert still creates the application, notifies admins and records
-- the intake version.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select pg_temp.direct_insert('b9b00000-0000-4000-8000-000000000004')$$,
 'The service key inserts an application');
reset role;
select is((select status from public.vendor_applications where id='b9b00000-0000-4000-8000-000000000004'),'pending','The application is pending');
select is((select count(*) from public.notifications where user_id='b9a00000-0000-4000-8000-000000000001'
 and type='vendor_application' and link='/admin/applications'),1::bigint,'The admin is notified of the new application');
select is((select count(*) from public.vendor_application_versions where application_id='b9b00000-0000-4000-8000-000000000004'),1::bigint,
 'The intake version is recorded');

select * from finish();
rollback;
