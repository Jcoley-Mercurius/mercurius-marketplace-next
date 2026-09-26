begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-085 synthetic fixtures only. A signed-in admin can no longer update or delete a
-- vendor_applications row, or overwrite, move or remove an object in the private
-- vendor-documents bucket, from a client. Reads and the reviewed SECURITY DEFINER commands
-- still work. Storage objects are synthetic rows with metadata only; no file, real
-- applicant, provider, account or document is represented.
insert into auth.users(id,email,email_confirmed_at) values
 ('b8800000-0000-4000-8000-000000000001','admin-writes-operator@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b8800000-0000-4000-8000-000000000001','admin');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls) values
 ('b8900000-0000-4000-8000-000000000001','Synthetic admin-writes applicant','Test','Applicant','admin-writes-1@example.invalid','synthetic','pending',
  array['b8900000-0000-4000-8000-000000000001/license/c8800000-0000-4000-8000-000000000001-synthetic-license.pdf']);
insert into storage.objects(bucket_id,name,metadata) values
 ('vendor-documents','b8900000-0000-4000-8000-000000000001/license/c8800000-0000-4000-8000-000000000001-synthetic-license.pdf',
  '{"size":2048,"mimetype":"application/pdf"}');

create function pg_temp.as_admin() returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8800000-0000-4000-8000-000000000001"}',true) $$;
create function pg_temp.application() returns text language sql as $$
 select concat_ws('|',status,business_name,array_to_string(document_urls,','),invite_status,contractor_id)
 from public.vendor_applications where id='b8900000-0000-4000-8000-000000000001' $$;
create function pg_temp.stored() returns text language sql as $$
 select concat_ws('|',bucket_id,name,metadata::text) from storage.objects
 where name like 'b8900000-0000-4000-8000-000000000001/%' $$;

-- Structure.
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='vendor_applications'
 and policyname in ('Admins can update applications','Admins can delete applications')),'The admin application update and delete policies are removed');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='vendor_applications'
 and cmd in ('UPDATE','DELETE','ALL')),'No policy permits a client to update or delete an application');
select ok(not has_table_privilege('authenticated','public.vendor_applications','UPDATE'),'A signed-in caller holds no UPDATE on applications');
select ok(not has_table_privilege('authenticated','public.vendor_applications','DELETE'),'A signed-in caller holds no DELETE on applications');
select ok(not has_any_column_privilege('authenticated','public.vendor_applications','UPDATE'),'Nor UPDATE on any application column');
select ok(not has_table_privilege('anon','public.vendor_applications','UPDATE') and not has_table_privilege('anon','public.vendor_applications','DELETE'),
 'An anonymous caller holds neither');
select ok(has_table_privilege('authenticated','public.vendor_applications','SELECT'),'A signed-in caller keeps SELECT, filtered by the admin read policy');
select ok(has_table_privilege('service_role','public.vendor_applications','UPDATE'),'The service key used by the upload route keeps UPDATE');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='vendor_applications'
 and policyname='Admins can view all applications' and cmd='SELECT'),'The admin read policy is unchanged');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='vendor_applications'
 and policyname='Anyone can submit vendor application'),'The applicant insert policy is removed by TRACE-086 (suite 053)');

select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
 and policyname in ('Admins can update vendor documents','Admins can delete vendor documents')),'The admin document update and delete policies are removed');
select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
 and cmd in ('INSERT','UPDATE','DELETE','ALL') and (coalesce(qual,'')||coalesce(with_check,'')) like '%''vendor-documents''%'),
 'No policy permits a client to write the vendor documents bucket');
select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
 and policyname='Admins can read vendor documents' and cmd='SELECT'),'Admins can still read vendor documents');
select is((select count(*) from pg_policies where schemaname='storage' and tablename='objects'
 and policyname in ('vendor_media_delete','vendor_media_update','vendor_logos_delete','vendor_gallery_delete','Users can delete own job photos')),5::bigint,
 'Other buckets keep their write policies');

-- A signed-in admin cannot write an application directly.
select pg_temp.as_admin();
set local role authenticated;
select is((select count(*) from public.vendor_applications where id='b8900000-0000-4000-8000-000000000001'),1::bigint,'An admin still reads the application');
select throws_ok($$update public.vendor_applications set status='rejected' where id='b8900000-0000-4000-8000-000000000001'$$,
 '42501',null,'An admin cannot set an application status directly');
select throws_ok($$update public.vendor_applications set document_urls='{}' where id='b8900000-0000-4000-8000-000000000001'$$,
 '42501',null,'An admin cannot change an application''s document list directly');
select throws_ok($$delete from public.vendor_applications where id='b8900000-0000-4000-8000-000000000001'$$,
 '42501',null,'An admin cannot delete an application');

-- Nor overwrite, move or remove a stored document. With no policy the rows are invisible to
-- the write, so nothing changes. The Storage delete guard is lifted so only RLS decides.
select is((select count(*) from storage.objects where name like 'b8900000-0000-4000-8000-000000000001/%'),1::bigint,'An admin still reads the stored document');
update storage.objects set bucket_id='vendor-documents-quarantine' where name like 'b8900000-0000-4000-8000-000000000001/%';
update storage.objects set metadata='{"size":1,"mimetype":"application/pdf"}' where name like 'b8900000-0000-4000-8000-000000000001/%';
update storage.objects set name='b8900000-0000-4000-8000-000000000001/license/renamed.pdf' where name like 'b8900000-0000-4000-8000-000000000001/%';
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where name like 'b8900000-0000-4000-8000-000000000001/%';
select set_config('storage.allow_delete_query','false',true);
reset role;
select is(pg_temp.stored(),
 'vendor-documents|b8900000-0000-4000-8000-000000000001/license/c8800000-0000-4000-8000-000000000001-synthetic-license.pdf|{"size": 2048, "mimetype": "application/pdf"}',
 'The document was not moved, overwritten, renamed or removed');
select is(pg_temp.application(),
 'pending|Synthetic admin-writes applicant|b8900000-0000-4000-8000-000000000001/license/c8800000-0000-4000-8000-000000000001-synthetic-license.pdf|not_invited',
 'The application is unchanged');

-- The reviewed command still closes the application.
select pg_temp.as_admin();
set local role authenticated;
select lives_ok($$select public.vendor_close_application('b8900000-0000-4000-8000-000000000001','rejected','Synthetic rejection','admin-writes-close-1')$$,
 'An admin closes the application through the reviewed command');
reset role;
select is((select status from public.vendor_applications where id='b8900000-0000-4000-8000-000000000001'),'rejected','The reviewed command set the status');
select is((select count(*) from public.vendor_application_closures where application_id='b8900000-0000-4000-8000-000000000001'),1::bigint,
 'And recorded the closure');

select * from finish();
rollback;
