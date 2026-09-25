begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-090 synthetic fixtures only. Covers retention of application uploads never attached
-- to the application (DEC-2026-012 item 5): due 7 days after the 2-hour upload grant
-- expires, measured from the object's creation; the evidence exemption; application and
-- provider holds; versions counting as attached; and TRACE-084's quarantine, restore and
-- deletion steps applied to these files. Storage objects are synthetic rows with metadata
-- only; no file, real applicant, provider, account or document is represented.
insert into auth.users(id,email,email_confirmed_at) values
 ('b8700000-0000-4000-8000-000000000001','unattached-operator@example.invalid',now()),
 ('b8700000-0000-4000-8000-000000000002','unattached-vendor@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b8700000-0000-4000-8000-000000000001','admin'),
 ('b8700000-0000-4000-8000-000000000002','vendor');

create function pg_temp.app(p_n integer) returns uuid language sql as $$
 select ('b8800000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
create function pg_temp.path(p_app integer,p_kind text,p_n integer) returns text language sql as $$
 select pg_temp.app(p_app)::text||'/'||p_kind||'/c8700000-0000-4000-8000-'||lpad(p_n::text,12,'0')||'-synthetic-'||p_kind||'.pdf' $$;
create function pg_temp.application(p_n integer,p_status text,p_listed text[]) returns void language sql as $$
 insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls)
   values(pg_temp.app(p_n),'Synthetic unattached '||p_n,'Test','Applicant','unattached-'||p_n||'@example.invalid','synthetic',p_status,p_listed) $$;
create function pg_temp.stored(p_path text,p_age interval,p_bucket text default 'vendor-documents') returns void language sql as $$
 insert into storage.objects(bucket_id,name,metadata,created_at)
   values(p_bucket,p_path,'{"size":2048,"mimetype":"application/pdf"}',now()-p_age) $$;
create function pg_temp.move(p_path text,p_to text) returns void language sql as $$
 update storage.objects set bucket_id=p_to where name=p_path $$;
create function pg_temp.remove(p_path text) returns void language plpgsql as $$
begin
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where name=p_path;
 perform set_config('storage.allow_delete_query','false',true);
end $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8700000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.step(p_fn text,p_app integer,p_path text,p_action text,p_key text) returns jsonb language plpgsql as $$
declare result jsonb;
begin
 execute format('select public.%I(%L,%L,%L,%L,%L)',p_fn,pg_temp.app(p_app),p_path,p_action,'Synthetic unattached step',p_key) into result;
 return result;
end $$;
create function pg_temp.listed(p_list text) returns text language sql as $$
 select coalesce(string_agg(right(split_part(e->>'path','/',1),1)||':'||split_part(e->>'path','/',2)||':'||substr(split_part(e->>'path','/',3),35,2),',' order by e->>'path'),'')
 from jsonb_array_elements(public.vendor_application_retention_queue()->p_list) e where e->>'path' like 'b8800000-%' $$;
create function pg_temp.entry(p_list text,p_path text) returns jsonb language sql as $$
 select e from jsonb_array_elements(public.vendor_application_retention_queue()->p_list) e where e->>'path'=p_path $$;
create function pg_temp.ledger() returns bigint language sql as $$
 select count(*) from public.vendor_application_retention_actions where application_id::text like 'b8800000-%' $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- 1: open application. license:1 listed; 2, 3, 4 never attached (just due, one minute
-- short, exactly due); a file outside the upload layout.
select pg_temp.application(1,'pending',array[pg_temp.path(1,'license',1)]);
select pg_temp.stored(pg_temp.path(1,'license',1),interval '30 days');
select pg_temp.stored(pg_temp.path(1,'insurance',2),interval '7 days 2 hours 1 minute');
select pg_temp.stored(pg_temp.path(1,'other',3),interval '7 days 2 hours'-interval '1 minute');
select pg_temp.stored(pg_temp.path(1,'license',4),interval '7 days 2 hours');
select pg_temp.stored(pg_temp.app(1)::text||'/license/notes.txt',interval '60 days');
-- 2: rejected ten days ago; its listed file is not due, its unattached one is.
select pg_temp.application(2,'pending',array[pg_temp.path(2,'license',5)]);
select pg_temp.stored(pg_temp.path(2,'license',5),interval '12 days');
select pg_temp.stored(pg_temp.path(2,'insurance',6),interval '8 days');
insert into public.vendor_application_closures(application_id,outcome,before_status,reason,business_key,actor,created_at)
 values(pg_temp.app(2),'rejected','pending','Synthetic closure','fixture-unattached-close-2','b8700000-0000-4000-8000-000000000001',now()-interval '10 days');
update public.vendor_applications set status='rejected' where id=pg_temp.app(2);
-- 3: application hold.
select pg_temp.application(3,'pending','{}');
select pg_temp.stored(pg_temp.path(3,'license',7),interval '9 days');
insert into public.vendor_application_retention_hold_events(application_id,action,reason,business_key,actor)
 values(pg_temp.app(3),'placed','Synthetic hold','fixture-unattached-hold-3','b8700000-0000-4000-8000-000000000001');
-- 4: unattached file bound to evidence. 5: provider hold.
select pg_temp.application(4,'pending','{}');
select pg_temp.stored(pg_temp.path(4,'license',8),interval '9 days');
select pg_temp.application(5,'pending','{}');
select pg_temp.stored(pg_temp.path(5,'license',9),interval '9 days');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b8900000-0000-4000-8000-000000000004','Synthetic evidence provider',false,false,null),
 ('b8900000-0000-4000-8000-000000000005','Synthetic held provider',false,false,null);
update public.vendor_applications set contractor_id='b8900000-0000-4000-8000-000000000004' where id=pg_temp.app(4);
update public.vendor_applications set contractor_id='b8900000-0000-4000-8000-000000000005' where id=pg_temp.app(5);
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select c,(select id from public.vendor_application_versions where application_id=a order by revision desc limit 1),1,'review'
 from (values('b8900000-0000-4000-8000-000000000004'::uuid,pg_temp.app(4)),('b8900000-0000-4000-8000-000000000005'::uuid,pg_temp.app(5))) v(c,a);
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,'license','license-v1',pg_temp.path(4,'license',8),now()-interval '1 day',now()+interval '1 year','b8700000-0000-4000-8000-000000000001'
 from public.vendor_onboarding o where o.contractor_id='b8900000-0000-4000-8000-000000000004';
insert into public.vendor_retention_hold_events(contractor_id,action,reason,business_key,actor)
 values('b8900000-0000-4000-8000-000000000005','placed','Synthetic provider hold','fixture-unattached-provider-hold','b8700000-0000-4000-8000-000000000001');
-- 6: a file listed once and then removed from the current row stays attached via its version.
select pg_temp.application(6,'pending',array[pg_temp.path(6,'license',10)]);
select pg_temp.stored(pg_temp.path(6,'license',10),interval '30 days');
update public.vendor_applications set document_urls='{}' where id=pg_temp.app(6);
-- 7: unattached files already quarantined 15 and 13 days ago.
select pg_temp.application(7,'pending','{}');
select pg_temp.stored(pg_temp.path(7,'license',11),interval '30 days','vendor-documents-quarantine');
select pg_temp.stored(pg_temp.path(7,'insurance',12),interval '30 days','vendor-documents-quarantine');
insert into public.vendor_application_retention_actions(application_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor,created_at) values
 (pg_temp.app(7),pg_temp.path(7,'license',11),'quarantined',2048,'Synthetic fixture',false,'fixture-unattached-q-11','b8700000-0000-4000-8000-000000000001',now()-interval '15 days'),
 (pg_temp.app(7),pg_temp.path(7,'insurance',12),'quarantined',2048,'Synthetic fixture',false,'fixture-unattached-q-12','b8700000-0000-4000-8000-000000000001',now()-interval '13 days');

-- Structure.
select ok(not has_function_privilege('authenticated','private.vendor_application_unattached_files(uuid)','EXECUTE'),
 'A signed-in caller cannot list unattached files directly');
select ok(not has_function_privilege('anon','private.vendor_application_unattached_files(uuid)','EXECUTE'),
 'An anonymous caller cannot list unattached files directly');
select ok(not has_function_privilege('service_role','private.vendor_application_unattached_files(uuid)','EXECUTE'),
 'The service key cannot list unattached files directly');
select is(private.vendor_application_upload_grant_hours(),2,'The upload grant lasts 2 hours');
select is(private.vendor_unattached_upload_days(),7,'Unattached uploads are kept 7 days after the grant expires');

-- Which files are unattached.
select is((select string_agg(split_part(path,'/',2)||':'||substr(split_part(path,'/',3),35,2),',' order by path)
   from private.vendor_application_unattached_files(pg_temp.app(1))),'insurance:02,license:04,other:03',
 'Only unlisted files in the upload layout are unattached');
select is((select count(*) from private.vendor_application_unattached_files(pg_temp.app(6))),0::bigint,
 'A file listed by an earlier version counts as attached');
select is((select uploaded_at from private.vendor_application_unattached_files(pg_temp.app(1)) where path=pg_temp.path(1,'insurance',2)),
 now()-interval '7 days 2 hours 1 minute','The upload time is the object''s creation time');

select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select public.vendor_application_retention_queue()$$,'42501',null,'A vendor cannot read the queue');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(1),pg_temp.path(1,'insurance',2),'quarantined','Synthetic','v-1'),
 '42501',null,'A vendor cannot prepare a step');
reset role;

select pg_temp.as_user('1');
set local role authenticated;
-- Queue.
select is(pg_temp.listed('unattached_due'),'1:insurance:02,1:license:04,2:insurance:06,3:license:07,5:license:09',
 'Due: past the clock, retained and not bound, whatever the application status, held ones included');
select is(pg_temp.listed('unattached_kept'),'4:license:08','Kept: the unattached file bound to evidence');
select is(pg_temp.listed('due'),'','No attached file of these applications is due');
select is((pg_temp.entry('unattached_due',pg_temp.path(1,'insurance',2))->>'attached')::boolean,false,'A due unattached file is marked unattached');
select is((pg_temp.entry('unattached_due',pg_temp.path(1,'insurance',2))->>'retention_ends_at')::timestamptz,
 now()-interval '1 minute','Its retention ends 7 days and 2 hours after upload');
select is((pg_temp.entry('unattached_due',pg_temp.path(3,'license',7))->>'held')::boolean,true,'An application hold is shown');
select is((pg_temp.entry('unattached_due',pg_temp.path(5,'license',9))->>'held')::boolean,true,'A provider hold is shown');
select is((public.vendor_application_retention_queue()->>'unattached_days')::int,7,'The queue states the 7-day clock');
select is((select string_agg(split_part(f->>'path','/',2)||':'||(f->>'attached'),',' order by f->>'path')
   from jsonb_array_elements(public.vendor_application_retention_overview(pg_temp.app(1))->'unattached_files') f),
 'insurance:false,license:false,other:false','The overview lists the application''s unattached files');
select is(jsonb_array_length(public.vendor_application_retention_overview(pg_temp.app(1))->'files'),1,'The overview''s attached files are unchanged');

-- Prepare refusals.
select throws_ok(format('select pg_temp.step(%L,1,%L,%L,%L)','vendor_application_retention_prepare',pg_temp.path(1,'other',3),'quarantined','k-3'),
 'P0001','Uploads never attached to an application are kept for 7 days after their upload link expires','One minute short of the clock is not due');
select throws_ok(format('select pg_temp.step(%L,1,%L,%L,%L)','vendor_application_retention_prepare',pg_temp.path(1,'license',1),'quarantined','k-1'),
 'P0001','Only documents of a rejected or abandoned application are subject to retention','An attached file of an open application is not due');
select throws_ok(format('select pg_temp.step(%L,2,%L,%L,%L)','vendor_application_retention_prepare',pg_temp.path(2,'license',5),'quarantined','k-5'),
 'P0001','Documents of a closed application are kept for 90 days','An attached file keeps the 90-day closure clock');
select throws_ok(format('select pg_temp.step(%L,6,%L,%L,%L)','vendor_application_retention_prepare',pg_temp.path(6,'license',10),'quarantined','k-10'),
 'P0001','Only documents of a rejected or abandoned application are subject to retention','A file listed by an earlier version keeps the attached rules');
select throws_ok(format('select pg_temp.step(%L,4,%L,%L,%L)','vendor_application_retention_prepare',pg_temp.path(4,'license',8),'quarantined','k-8'),
 'P0001','Documents bound to compliance evidence are kept','An unattached file bound to evidence is kept');
select throws_ok(format('select pg_temp.step(%L,3,%L,%L,%L)','vendor_application_retention_prepare',pg_temp.path(3,'license',7),'quarantined','k-7'),
 'P0001','This application is on a retention hold','An application hold refuses quarantine');
select throws_ok(format('select pg_temp.step(%L,5,%L,%L,%L)','vendor_application_retention_prepare',pg_temp.path(5,'license',9),'quarantined','k-9'),
 'P0001','This application is on a retention hold','A provider hold refuses quarantine');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(1),pg_temp.app(1)::text||'/license/notes.txt','quarantined','Synthetic','k-x'),
 'P0001','Document does not belong to this application','A file outside the upload layout is refused');
select throws_ok(format('select pg_temp.step(%L,2,%L,%L,%L)','vendor_application_retention_prepare',pg_temp.path(1,'insurance',2),'quarantined','k-x'),
 'P0001','Document does not belong to this application','Another application''s unattached file is refused');
select throws_ok(format('select pg_temp.step(%L,7,%L,%L,%L)','vendor_application_retention_prepare',pg_temp.path(7,'insurance',12),'deleted','k-12'),
 'P0001','Quarantined documents are kept for 14 days before deletion','An unattached file quarantined 13 days ago cannot be deleted');
reset role;
select is(pg_temp.ledger(),2::bigint,'Refusals record nothing');

-- Quarantine a due unattached file of a rejected application and of an open one.
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.step('vendor_application_retention_prepare',2,pg_temp.path(2,'insurance',6),'quarantined','q-6')->>'to_bucket',
 'vendor-documents-quarantine','A due unattached file of a closed application can be quarantined after 7 days, not 90');
select is(pg_temp.step('vendor_application_retention_prepare',1,pg_temp.path(1,'license',4),'quarantined','q-4')->>'replay',
 'false','A file exactly at the end of its clock can be quarantined');
select throws_ok(format('select pg_temp.step(%L,1,%L,%L,%L)','vendor_application_retention_record',pg_temp.path(1,'insurance',2),'quarantined','q-2'),
 'P0001','Storage does not show this document in quarantine','Recording before storage moved the file is refused');
reset role;
select pg_temp.move(pg_temp.path(1,'insurance',2),'vendor-documents-quarantine');
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.step('vendor_application_retention_record',1,pg_temp.path(1,'insurance',2),'quarantined','q-2')->>'recorded','true',
 'The quarantine is recorded once storage shows it');
select is(pg_temp.step('vendor_application_retention_record',1,pg_temp.path(1,'insurance',2),'quarantined','q-2')->>'recorded','false',
 'The same key replays');
select is(pg_temp.listed('unattached_due'),'1:license:04,2:insurance:06,3:license:07,5:license:09','The quarantined file leaves the due list');
select is((pg_temp.entry('quarantined',pg_temp.path(1,'insurance',2))->>'attached')::boolean,false,
 'It appears in quarantine, marked unattached');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(1),pg_temp.path(1,'insurance',2),'quarantined','Synthetic','q-2b'),
 'P0001','Application document already quarantined','A second quarantine is refused');
reset role;

-- The evidence guard still refuses a quarantined unattached file.
select throws_ok(format('insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by) select contractor_id,application_version_id,%L,%L,%L,now()-interval ''1 day'',now()+interval ''1 year'',%L from public.vendor_onboarding where contractor_id=%L',
  'insurance','insurance-v1',pg_temp.path(1,'insurance',2),'b8700000-0000-4000-8000-000000000001','b8900000-0000-4000-8000-000000000004'),
 'P0001','A document in retention quarantine cannot become evidence','A quarantined unattached file cannot become evidence');

-- Restore and delete.
select pg_temp.move(pg_temp.path(7,'insurance',12),'vendor-documents');
select pg_temp.remove(pg_temp.path(7,'license',11));
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.step('vendor_application_retention_record',7,pg_temp.path(7,'insurance',12),'restored','r-12')->>'recorded','true',
 'A quarantined unattached file can be restored');
select is(pg_temp.step('vendor_application_retention_prepare',7,pg_temp.path(7,'license',11),'deleted','d-11')->>'replay','false',
 'An unattached file 15 days in quarantine may be deleted');
select is(pg_temp.step('vendor_application_retention_record',7,pg_temp.path(7,'license',11),'deleted','d-11')->>'recorded','true',
 'The deletion is recorded once storage shows the file gone');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(7),pg_temp.path(7,'license',11),'restored','Synthetic','d-11b'),
 'P0001','Application document already deleted','A deleted unattached file stays deleted');
select is((select string_agg(f->>'retention_state',',' order by f->>'path')
   from jsonb_array_elements(public.vendor_application_retention_overview(pg_temp.app(7))->'unattached_files') f),
 'retained,deleted','The ledger still knows a deleted unattached file');
select is(pg_temp.listed('unattached_due'),'1:license:04,2:insurance:06,3:license:07,5:license:09,7:insurance:12',
 'A restored unattached file past its clock is due again');
reset role;

-- Nothing else changed.
select is((select string_agg(status,',' order by id) from public.vendor_applications where id::text like 'b8800000-%'),
 'pending,rejected,pending,pending,pending,pending,pending','No application status changed');
select is((select count(*) from public.vendor_application_closures where application_id::text like 'b8800000-%'),1::bigint,'No closure was recorded');
select is((select count(*) from public.vendor_compliance_evidence where evidence_ref like 'b8800000-%'),1::bigint,'No evidence changed');

select * from finish();
rollback;
