begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-094 synthetic fixtures only. Covers the atomic attachment of finalized application
-- uploads: only the service key may call it; paths must be in the application's upload
-- layout and stored; the append keeps existing paths, adds each new path once in request
-- order, and a request that adds nothing changes no row or version. The concurrent
-- partial-finalization race is in scripts/phase5-document-attach-concurrency.mjs. Storage
-- objects are synthetic rows with metadata only.
create function pg_temp.app(p_n integer) returns uuid language sql as $$
 select ('ba100000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
create function pg_temp.path(p_app integer,p_kind text,p_n integer) returns text language sql as $$
 select pg_temp.app(p_app)::text||'/'||p_kind||'/ca100000-0000-4000-8000-'||lpad(p_n::text,12,'0')||'-synthetic-'||p_kind||'.pdf' $$;
create function pg_temp.listed(p_app integer) returns text language sql as $$
 select array_to_string(document_urls,',') from public.vendor_applications where id=pg_temp.app(p_app) $$;
create function pg_temp.versions(p_app integer) returns bigint language sql as $$
 select count(*) from public.vendor_application_versions where application_id=pg_temp.app(p_app) $$;

insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls)
 select pg_temp.app(n),'Synthetic attach applicant '||n,'Test','Applicant','attach-'||n||'@example.invalid','synthetic','pending','{}'
 from generate_series(1,2) n;
insert into storage.objects(bucket_id,name,metadata)
 select 'vendor-documents',pg_temp.path(1,k,n),'{"size":2048,"mimetype":"application/pdf"}'
 from (values('license',1),('insurance',2),('other',3)) f(k,n);
insert into storage.objects(bucket_id,name,metadata)
 values('vendor-documents',pg_temp.path(2,'license',4),'{"size":2048,"mimetype":"application/pdf"}');

select ok(has_function_privilege('service_role','public.vendor_application_attach_documents(uuid,text[])','execute'),'The service key used by the finalize route may attach');
select ok(not has_function_privilege('authenticated','public.vendor_application_attach_documents(uuid,text[])','execute')
 and not has_function_privilege('anon','public.vendor_application_attach_documents(uuid,text[])','execute'),'No client may attach documents');

set local role service_role;
select is(public.vendor_application_attach_documents(pg_temp.app(1),array[pg_temp.path(1,'license',1)])->>'added','1','One path is attached');
select is(public.vendor_application_attach_documents(pg_temp.app(1),array[pg_temp.path(1,'insurance',2)])->>'added','1',
 'A second request with another path from the same grant is attached');
reset role;
select is(pg_temp.listed(1),pg_temp.path(1,'license',1)||','||pg_temp.path(1,'insurance',2),'The current row keeps both, in order');
select is(pg_temp.versions(1),3::bigint,'Each attachment that changed the list made one version');
set local role service_role;
select is(public.vendor_application_attach_documents(pg_temp.app(1),array[pg_temp.path(1,'license',1),pg_temp.path(1,'other',3),pg_temp.path(1,'other',3)])->>'added','1',
 'A retry with a listed path and a new one adds the new one once');
select is(public.vendor_application_attach_documents(pg_temp.app(1),array[pg_temp.path(1,'license',1)])->'document_paths',
 to_jsonb(array[pg_temp.path(1,'license',1),pg_temp.path(1,'insurance',2),pg_temp.path(1,'other',3)]),'A replay returns the full list');
reset role;
select is(pg_temp.versions(1),4::bigint,'A request that adds nothing makes no version');

set local role service_role;
select throws_ok(format('select public.vendor_application_attach_documents(%L,array[%L])',pg_temp.app(1),pg_temp.path(2,'license',4)),
 'P0001','Document path does not belong to this application','A path from another application is refused');
select throws_ok(format('select public.vendor_application_attach_documents(%L,array[%L])',pg_temp.app(1),pg_temp.app(1)::text||'/license/not-in-layout.pdf'),
 'P0001','Document path does not belong to this application','A path outside the upload layout is refused');
select throws_ok(format('select public.vendor_application_attach_documents(%L,array[%L])',pg_temp.app(1),pg_temp.path(1,'license',9)),
 'P0001','Uploaded document not found','A path with no stored object is refused');
select throws_ok(format('select public.vendor_application_attach_documents(%L,array[%L])',pg_temp.app(3),pg_temp.path(3,'license',1)),
 'P0001','Application not found','An unknown application is refused');
select throws_ok(format('select public.vendor_application_attach_documents(%L,%L::text[])',pg_temp.app(1),'{}'),
 'P0001','Choose between 1 and 12 documents to attach','An empty request is refused');
reset role;
select is(pg_temp.listed(1),pg_temp.path(1,'license',1)||','||pg_temp.path(1,'insurance',2)||','||pg_temp.path(1,'other',3),'Refused requests change nothing');
select is(pg_temp.listed(2),'','The other application is untouched');

select * from finish();
rollback;
