begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-087 synthetic fixtures only. No anonymous or signed-in client can insert a
-- contact_submissions row directly; the contact route's service key still can, and admins
-- still read submissions. The duplicate admin read policy on vendor-documents is gone and
-- admins still read the bucket. Storage objects are synthetic rows with metadata only; no
-- real sender, applicant, provider, account or document is represented.
insert into auth.users(id,email,email_confirmed_at) values
 ('b9c00000-0000-4000-8000-000000000001','contact-insert-operator@example.invalid',now()),
 ('b9c00000-0000-4000-8000-000000000002','contact-insert-member@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b9c00000-0000-4000-8000-000000000001','admin');
insert into storage.objects(bucket_id,name,metadata) values
 ('vendor-documents','b9d00000-0000-4000-8000-000000000009/license/c9c00000-0000-4000-8000-000000000001-synthetic-license.pdf',
  '{"size":2048,"mimetype":"application/pdf"}');

-- A row the old policy accepted: every checked field within its limits.
create function pg_temp.direct_insert(p_id uuid) returns void language sql as $$
 insert into public.contact_submissions(id,first_name,last_name,email,phone,subject,message)
 values (p_id,'Test','Sender','contact-insert@example.invalid','5550000000','Synthetic subject','Synthetic message') $$;
create function pg_temp.as_user(p_user uuid) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',p_user)::text,true) $$;
create function pg_temp.as_anon() returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"anon"}',true) $$;

-- Structure.
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='contact_submissions'
 and policyname='Anyone can submit contact form'),'The anonymous contact insert policy is removed');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='contact_submissions'
 and cmd in ('INSERT','ALL')),'No policy permits a client to insert a contact submission');
select ok(not has_table_privilege('anon','public.contact_submissions','INSERT'),'An anonymous caller holds no INSERT on contact submissions');
select ok(not has_any_column_privilege('anon','public.contact_submissions','INSERT'),'Nor INSERT on any contact submission column');
select ok(not has_table_privilege('authenticated','public.contact_submissions','INSERT'),'A signed-in caller holds no INSERT on contact submissions');
select ok(not has_any_column_privilege('authenticated','public.contact_submissions','INSERT'),'Nor INSERT on any contact submission column');
select ok(not has_table_privilege('anon','public.contact_submissions','SELECT'),'An anonymous caller still cannot read contact submissions');
select ok(has_table_privilege('authenticated','public.contact_submissions','SELECT'),'A signed-in caller keeps SELECT, filtered by the admin read policy');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='contact_submissions'
 and policyname='Admins can view submissions' and cmd='SELECT'),'The admin read policy is unchanged');
select ok(has_table_privilege('service_role','public.contact_submissions','INSERT'),'The service key used by the contact route keeps INSERT');

select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
 and policyname='Admins can review vendor application documents'),'The duplicate vendor document read policy is removed');
select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
 and policyname='Admins can read vendor documents' and cmd='SELECT'),'The admin vendor document read policy is unchanged');
select is((select count(*) from pg_policies where schemaname='storage' and tablename='objects'
 and cmd in ('SELECT','ALL') and coalesce(qual,'') like '%vendor-documents%'),1::bigint,
 'Exactly one policy lets a client read the vendor documents bucket');

-- No client can insert a row the old policy accepted.
select pg_temp.as_anon();
set local role anon;
select throws_ok($$select pg_temp.direct_insert('b9e00000-0000-4000-8000-000000000001')$$,
 '42501',null,'An anonymous caller cannot insert a contact submission directly');
reset role;
select pg_temp.as_user('b9c00000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select pg_temp.direct_insert('b9e00000-0000-4000-8000-000000000002')$$,
 '42501',null,'A signed-in non-admin cannot insert a contact submission directly');
reset role;
select pg_temp.as_user('b9c00000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select pg_temp.direct_insert('b9e00000-0000-4000-8000-000000000003')$$,
 '42501',null,'A signed-in admin cannot insert a contact submission directly');
reset role;
select is((select count(*) from public.contact_submissions where id::text like 'b9e00000-%'),0::bigint,'No contact submission was created');

-- The route's service-key insert still creates the submission, and only an admin reads it.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select pg_temp.direct_insert('b9e00000-0000-4000-8000-000000000004')$$,
 'The service key inserts a contact submission');
reset role;
select pg_temp.as_user('b9c00000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*) from public.contact_submissions where id='b9e00000-0000-4000-8000-000000000004'),1::bigint,
 'An admin reads the submission');
select is((select count(*) from storage.objects where name like 'b9d00000-0000-4000-8000-000000000009/%'),1::bigint,
 'An admin still reads a stored vendor document');
reset role;
select pg_temp.as_user('b9c00000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*) from public.contact_submissions where id='b9e00000-0000-4000-8000-000000000004'),0::bigint,
 'A signed-in non-admin does not see the submission');
select is((select count(*) from storage.objects where name like 'b9d00000-0000-4000-8000-000000000009/%'),0::bigint,
 'Nor a stored vendor document');
reset role;

select * from finish();
rollback;
