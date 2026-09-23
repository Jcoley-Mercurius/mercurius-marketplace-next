begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-084 synthetic fixtures only. Covers CFG-011 retention of the documents of rejected
-- or abandoned vendor applications: recorded closures, the onboarding-rejection clock,
-- the 90-day window, the evidence exemption, application and provider holds, storage
-- verification, the evidence guard and the readbacks. Storage objects are synthetic rows
-- with metadata only, moved here the way the Storage API moves them; no file, real
-- applicant, provider, account or document is represented.
insert into auth.users(id,email,email_confirmed_at) values
 ('b8400000-0000-4000-8000-000000000001','app-retention-operator@example.invalid',now()),
 ('b8400000-0000-4000-8000-000000000002','app-retention-vendor@example.invalid',now()),
 ('b8400000-0000-4000-8000-000000000003','app-retention-operator-two@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b8400000-0000-4000-8000-000000000001','admin'),
 ('b8400000-0000-4000-8000-000000000002','vendor'),
 ('b8400000-0000-4000-8000-000000000003','admin');

create function pg_temp.app(p_n integer) returns uuid language sql as $$
 select ('b8600000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
create function pg_temp.path(p_app integer,p_kind text,p_n integer) returns text language sql as $$
 select pg_temp.app(p_app)::text||'/'||p_kind||'/c8400000-0000-4000-8000-'||lpad(p_n::text,12,'0')||'-synthetic-'||p_kind||'.pdf' $$;
-- An application listing p_files (kind:n) with each file stored in the documents bucket.
create function pg_temp.application(p_n integer,p_status text,p_files text[]) returns void language plpgsql as $$
declare f text;
begin
 insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls)
   values(pg_temp.app(p_n),'Synthetic applicant '||p_n,'Test','Applicant','app-retention-'||p_n||'@example.invalid','synthetic',p_status,
     coalesce((select array_agg(pg_temp.path(p_n,split_part(x,':',1),split_part(x,':',2)::int)) from unnest(p_files) x),'{}'));
 foreach f in array p_files loop
   insert into storage.objects(bucket_id,name,metadata)
     values('vendor-documents',pg_temp.path(p_n,split_part(f,':',1),split_part(f,':',2)::int),'{"size":2048,"mimetype":"application/pdf"}');
 end loop;
end $$;
create function pg_temp.closed(p_n integer,p_outcome text,p_age interval) returns void language plpgsql as $$
begin
 insert into public.vendor_application_closures(application_id,outcome,before_status,reason,business_key,actor,created_at)
   values(pg_temp.app(p_n),p_outcome,'pending','Synthetic closure','fixture-close-'||p_n,'b8400000-0000-4000-8000-000000000001',now()-p_age);
 update public.vendor_applications set status=p_outcome where id=pg_temp.app(p_n);
end $$;
-- Storage API equivalents: move between buckets, and delete.
create function pg_temp.move(p_path text,p_to text) returns void language sql as $$
 update storage.objects set bucket_id=p_to where name=p_path $$;
create function pg_temp.remove(p_path text) returns void language plpgsql as $$
begin
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where name=p_path;
 perform set_config('storage.allow_delete_query','false',true);
end $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8400000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.queue_paths(p_list text) returns text language sql as $$
 select string_agg(right(split_part(e->>'path','/',1),2)||':'||split_part(e->>'path','/',2)||':'||substr(split_part(e->>'path','/',3),35,2),',' order by e->>'path')
 from jsonb_array_elements(public.vendor_application_retention_queue()->p_list) e where e->>'path' like 'b8600000-%' $$;
create function pg_temp.entry(p_list text,p_path text) returns jsonb language sql as $$
 select e from jsonb_array_elements(public.vendor_application_retention_queue()->p_list) e where e->>'path'=p_path $$;
create function pg_temp.file(p_app integer,p_path text) returns jsonb language sql as $$
 select f from jsonb_array_elements(public.vendor_application_retention_overview(pg_temp.app(p_app))->'files') f where f->>'path'=p_path $$;
-- Everything retention must never change.
create function pg_temp.state() returns text language sql as $$ select md5(concat_ws('|',
 (select string_agg(id||':'||coalesce(contractor_id::text,'')||':'||array_to_string(document_urls,';'),',' order by id) from public.vendor_applications where id::text like 'b8600000-%'),
 (select count(*) from public.vendor_application_versions),
 (select count(*) from public.vendor_compliance_evidence),
 (select string_agg(contractor_id||':'||status||':'||revision,',' order by contractor_id) from public.vendor_onboarding),
 (select count(*) from public.vendor_onboarding_events),
 (select count(*) from public.user_roles),
 (select string_agg(id||':'||coalesce(is_active::text,'null')||':'||marketing_enabled::text,',' order by id) from public.contractors))) $$;
create function pg_temp.ledger() returns text language sql as $$ select md5(concat_ws('|',
 (select count(*) from public.vendor_application_closures),(select count(*) from public.vendor_application_retention_actions),
 (select count(*) from public.vendor_application_retention_hold_events),(select count(*) from public.vendor_retention_hold_events),
 (select string_agg(id||status,',' order by id) from public.vendor_applications where id::text like 'b8600000-%'),
 (select string_agg(bucket_id||name,',' order by bucket_id,name) from storage.objects where name like 'b8600000-%'))) $$;
create temp table snap(k text primary key,v text);
grant all on snap to authenticated;

-- 1: pending, license 1 and other 2 (closed during the test).
-- 2: abandoned 100 days ago, insurance 3 (application hold).
-- 3: rejected exactly 90 days ago, license 4 (due). 4: rejected one second short, license 5.
-- 5: legacy status rejected with no record, license 6.
-- 6: provider rejected through onboarding 120 days ago; license 7 bound to evidence, insurance 8.
-- 7: rejected 120 days ago; license 9 quarantined exactly 14 days, insurance 10 one second short.
-- 8: rejected 120 days ago, file 11 quarantined 20 days ago, then status reopened to pending.
-- 9: approved, license 12, plus a listed path outside the upload layout.
-- 10: pending with a provider under onboarding review, license 13.
-- 11: legacy data with a rejection recorded 120 days ago and a provider rejected through
--     onboarding 30 days ago; license 14.
select pg_temp.application(1,'pending',array['license:1','other:2']);
select pg_temp.application(2,'pending',array['insurance:3']);
select pg_temp.application(3,'pending',array['license:4']);
select pg_temp.application(4,'pending',array['license:5']);
select pg_temp.application(5,'rejected',array['license:6']);
select pg_temp.application(6,'approved',array['license:7','insurance:8']);
select pg_temp.application(7,'pending',array['license:9','insurance:10']);
select pg_temp.application(8,'pending',array['license:11']);
select pg_temp.application(9,'approved',array['license:12']);
select pg_temp.application(10,'pending',array['license:13']);
select pg_temp.application(11,'pending',array['license:14']);
update public.vendor_applications set document_urls=document_urls||array['synthetic/outside-layout.pdf',pg_temp.path(2,'insurance',3)] where id=pg_temp.app(9);
select pg_temp.closed(2,'abandoned',interval '100 days');
select pg_temp.closed(3,'rejected',interval '90 days');
select pg_temp.closed(4,'rejected',interval '90 days'-interval '1 second');
select pg_temp.closed(7,'rejected',interval '120 days');
select pg_temp.closed(8,'rejected',interval '120 days');
select pg_temp.closed(11,'rejected',interval '120 days');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b8500000-0000-4000-8000-000000000006','Synthetic rejected provider',false,false,null),
 ('b8500000-0000-4000-8000-000000000010','Synthetic reviewed provider',false,false,null),
 ('b8500000-0000-4000-8000-000000000011','Synthetic legacy provider',false,false,null);
update public.vendor_applications set contractor_id='b8500000-0000-4000-8000-000000000006' where id=pg_temp.app(6);
update public.vendor_applications set contractor_id='b8500000-0000-4000-8000-000000000010' where id=pg_temp.app(10);
update public.vendor_applications set contractor_id='b8500000-0000-4000-8000-000000000011' where id=pg_temp.app(11);
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select c,(select id from public.vendor_application_versions where application_id=a order by revision desc limit 1),1,'review'
 from (values('b8500000-0000-4000-8000-000000000006'::uuid,pg_temp.app(6)),('b8500000-0000-4000-8000-000000000010'::uuid,pg_temp.app(10)),
   ('b8500000-0000-4000-8000-000000000011'::uuid,pg_temp.app(11))) v(c,a);
insert into public.vendor_onboarding_events(contractor_id,revision,action,before_status,after_status,actor,reason,business_key,created_at)
 values('b8500000-0000-4000-8000-000000000011',2,'reject','review','rejected','b8400000-0000-4000-8000-000000000001','Synthetic later rejection','fixture-onboarding-reject-11',now()-interval '30 days');
update public.vendor_onboarding set status='rejected',revision=2 where contractor_id='b8500000-0000-4000-8000-000000000011';
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,'license','license-v1',pg_temp.path(6,'license',7),now()-interval '130 days',now()+interval '1 year','b8400000-0000-4000-8000-000000000001'
 from public.vendor_onboarding o where o.contractor_id='b8500000-0000-4000-8000-000000000006';
insert into public.vendor_onboarding_events(contractor_id,revision,action,before_status,after_status,actor,reason,business_key,created_at)
 values('b8500000-0000-4000-8000-000000000006',2,'reject','review','rejected','b8400000-0000-4000-8000-000000000001','Synthetic onboarding rejection','fixture-onboarding-reject',now()-interval '120 days');
update public.vendor_onboarding set status='rejected',revision=2 where contractor_id='b8500000-0000-4000-8000-000000000006';
select pg_temp.move(pg_temp.path(7,'license',9),'vendor-documents-quarantine');
select pg_temp.move(pg_temp.path(7,'insurance',10),'vendor-documents-quarantine');
select pg_temp.move(pg_temp.path(8,'license',11),'vendor-documents-quarantine');
insert into public.vendor_application_retention_actions(application_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor,created_at) values
 (pg_temp.app(7),pg_temp.path(7,'license',9),'quarantined',2048,'Synthetic fixture',false,'fixture-q-9','b8400000-0000-4000-8000-000000000001',now()-interval '14 days'),
 (pg_temp.app(7),pg_temp.path(7,'insurance',10),'quarantined',2048,'Synthetic fixture',false,'fixture-q-10','b8400000-0000-4000-8000-000000000001',now()-interval '14 days'+interval '1 second'),
 (pg_temp.app(8),pg_temp.path(8,'license',11),'quarantined',2048,'Synthetic fixture',false,'fixture-q-11','b8400000-0000-4000-8000-000000000001',now()-interval '20 days');
update public.vendor_applications set status='pending' where id=pg_temp.app(8);
insert into snap values('state',pg_temp.state());
insert into snap select 'version-1',id::text from public.vendor_application_versions where application_id=pg_temp.app(1);

-- Access.
set local role anon;
select throws_ok($$select public.vendor_application_retention_queue()$$,'42501','permission denied for function vendor_application_retention_queue','Anonymous caller cannot read the queue');
select throws_ok($$select public.vendor_close_application(null,'rejected','x','x')$$,'42501','permission denied for function vendor_close_application','Anonymous caller cannot close an application');
reset role;
set local role service_role;
select throws_ok($$select public.vendor_application_retention_record(null,null,'deleted','x','x')$$,'42501','permission denied for function vendor_application_retention_record','Service role cannot record retention');
select throws_ok($$select public.vendor_place_application_retention_hold(null,'x','x')$$,'42501','permission denied for function vendor_place_application_retention_hold','Service role cannot place a hold');
reset role;
set local role authenticated;
select throws_ok($$select private.vendor_application_closure(null)$$,'42501','permission denied for schema private','Retention helpers are not client functions');
select throws_ok($$select count(*) from public.vendor_application_closures$$,'42501','permission denied for table vendor_application_closures','Clients cannot read closures');
select throws_ok($$select count(*) from public.vendor_application_retention_actions$$,'42501','permission denied for table vendor_application_retention_actions','Clients cannot read retention actions');
select throws_ok($$select count(*) from public.vendor_application_retention_hold_events$$,'42501','permission denied for table vendor_application_retention_hold_events','Clients cannot read hold events');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select public.vendor_application_retention_queue()$$,'42501','Onboarding operator required','A vendor cannot read the queue');
select throws_ok(format('select public.vendor_application_retention_overview(%L)',pg_temp.app(1)),'42501','Onboarding operator required','A vendor cannot read an application overview');
select throws_ok(format('select public.vendor_close_application(%L,%L,%L,%L)',pg_temp.app(1),'rejected','x','vendor-key'),'42501','Onboarding operator required','A vendor cannot close an application');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','x','vendor-key'),'42501','Onboarding operator required','A vendor cannot prepare retention');
select throws_ok(format('select public.vendor_application_retention_record(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','x','vendor-key'),'42501','Onboarding operator required','A vendor cannot record retention');
select throws_ok(format('select public.vendor_place_application_retention_hold(%L,%L,%L)',pg_temp.app(2),'x','vendor-key'),'42501','Onboarding operator required','A vendor cannot place a hold');
select throws_ok(format('select public.vendor_release_application_retention_hold(%L,%L,%L)',pg_temp.app(2),'x','vendor-key'),'42501','Onboarding operator required','A vendor cannot release a hold');
reset role;

-- Queue before any step.
insert into snap values('ledger-0',pg_temp.ledger());
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.queue_paths('due'),'02:insurance:03,03:license:04,06:insurance:08',
 'Due lists files of applications closed at least 90 days ago, still retained and not bound to evidence');
select is(pg_temp.queue_paths('quarantined'),'07:insurance:10,07:license:09,08:license:11','Quarantined lists files in quarantine, including a reopened application''s');
select is(pg_temp.queue_paths('kept'),'06:license:07','Kept lists a closed application''s file bound to evidence');
select is((select string_agg(right(e->>'application_id',2)||':'||(e->>'status')||':'||(e->>'has_provider'),',') from jsonb_array_elements(public.vendor_application_retention_queue()->'unrecorded') e
 where e->>'application_id' like 'b8600000-%'),'05:rejected:false','Unrecorded lists a legacy rejection with no closure record');
select is((pg_temp.entry('due',pg_temp.path(3,'license',4))->>'retention_ends_at')::timestamptz,now(),'Retention ends 90 days after the recorded rejection');
select is(pg_temp.entry('due',pg_temp.path(3,'license',4))->>'closure_source','closure','A recorded rejection is the source');
select is(pg_temp.entry('due',pg_temp.path(2,'insurance',3))->>'closure_outcome','abandoned','An abandonment starts the same clock');
select is(pg_temp.entry('due',pg_temp.path(6,'insurance',8))->>'closure_source','onboarding','An onboarding rejection starts the clock');
select is((pg_temp.entry('due',pg_temp.path(6,'insurance',8))->>'closed_at')::timestamptz,now()-interval '120 days','from the rejection event');
select is(pg_temp.entry('due',pg_temp.path(3,'license',4))->>'file_name','synthetic-license.pdf','The file name drops the upload prefix');
select is(pg_temp.entry('due',pg_temp.path(3,'license',4))->>'kind','license','The kind comes from the path');
select is(pg_temp.entry('due',pg_temp.path(3,'license',4))->>'object_location','documents','A due entry reports where the file is');
select is(pg_temp.entry('due',pg_temp.path(3,'license',4))->>'held','false','A due entry reports no hold');
select is((pg_temp.entry('quarantined',pg_temp.path(7,'license',9))->>'quarantine_ends_at')::timestamptz,now(),'Quarantine ends 14 days after the quarantine');
select is(pg_temp.entry('kept',pg_temp.path(6,'license',7))->>'bound_to_evidence','true','A kept file reports its evidence binding');
select is(public.vendor_application_retention_queue()->'holds','[]'::jsonb,'No application holds are in force');
select is((select count(*) from jsonb_array_elements(public.vendor_application_retention_overview(pg_temp.app(9))->'files')),1::bigint,
 'A listed path outside the upload layout is not an application file');
select ok(not exists(select 1 from jsonb_array_elements(public.vendor_application_retention_overview(pg_temp.app(9))->'files') f where f->>'path'=pg_temp.path(2,'insurance',3)),
 'Another application''s file listed on an application is not its file');
select is((public.vendor_application_retention_overview(pg_temp.app(11))->'closure'->>'closed_at')::timestamptz,now()-interval '30 days',
 'With a recorded closure and a later onboarding rejection, the later clock is used');
select is(pg_temp.entry('due',pg_temp.path(11,'license',14)),null,'so the file is not due early');
reset role;
select is(pg_temp.ledger(),(select v from snap where k='ledger-0'),'Reading the queue wrote nothing');

-- Closing an application.
insert into snap select 'versions',count(*)::text from public.vendor_application_versions where application_id in (pg_temp.app(1),pg_temp.app(5),pg_temp.app(9));
select pg_temp.as_user('1');
set local role authenticated;
select is(public.vendor_application_retention_overview(pg_temp.app(1))->'close_outcomes','["rejected","abandoned"]'::jsonb,'A pending application may be rejected or abandoned');
select is(public.vendor_application_retention_overview(pg_temp.app(9))->'close_outcomes','["rejected","abandoned"]'::jsonb,'So may an approved application with no provider');
select is(public.vendor_application_retention_overview(pg_temp.app(5))->'close_outcomes','["rejected"]'::jsonb,'A legacy rejection may only be recorded as a rejection');
select is(public.vendor_application_retention_overview(pg_temp.app(10))->>'closable','false','An application with a provider is not closable here');
select is(public.vendor_application_retention_overview(pg_temp.app(10))->>'has_provider','true','and reports its provider');
select is(public.vendor_application_retention_overview(pg_temp.app(2))->'closure'->>'reason','Synthetic closure','The overview reports the closure reason');
select throws_ok(format('select public.vendor_close_application(%L,%L,%L,%L)',pg_temp.app(1),'rejected','  ','c-1'),'P0001','A reason is required','A closure needs a reason');
select throws_ok(format('select public.vendor_close_application(%L,%L,%L,%L)',pg_temp.app(1),'rejected','Synthetic reason',' '),'P0001','Idempotency key required','A closure needs a key');
select throws_ok(format('select public.vendor_close_application(%L,%L,%L,%L)',pg_temp.app(1),'approved','Synthetic reason','c-1'),'P0001','Choose rejected or abandoned','Only rejected or abandoned closes');
select throws_ok(format('select public.vendor_close_application(%L,%L,%L,%L)','b8600000-0000-4000-8000-000000000099','rejected','Synthetic reason','c-99'),'P0001','Application not found','An unknown application is refused');
select throws_ok(format('select public.vendor_close_application(%L,%L,%L,%L)',pg_temp.app(10),'rejected','Synthetic reason','c-10'),
 'P0001','This application has a provider record; decide it through onboarding review','An application under onboarding review is decided there');
select throws_ok(format('select public.vendor_close_application(%L,%L,%L,%L)',pg_temp.app(6),'rejected','Synthetic reason','c-6'),
 'P0001','This application has a provider record; decide it through onboarding review','So is an onboarding-rejected application');
select throws_ok(format('select public.vendor_close_application(%L,%L,%L,%L)',pg_temp.app(2),'rejected','Synthetic reason','c-2'),'P0001','Application is already closed','A closed application is not closed twice');
select throws_ok(format('select public.vendor_close_application(%L,%L,%L,%L)',pg_temp.app(5),'abandoned','Synthetic reason','c-5'),
 'P0001','Only a pending or approved application can be closed','A legacy rejection cannot be recorded as another outcome');
select is(public.vendor_close_application(pg_temp.app(1),'rejected','Synthetic reason ','c-1')-'closed_at',
 jsonb_build_object('application_id',pg_temp.app(1),'outcome','rejected','recorded',true),'An operator rejects an application with a reason');
select is(public.vendor_close_application(pg_temp.app(1),'rejected','Synthetic reason','c-1')->>'recorded','false','The same request replays');
select throws_ok(format('select public.vendor_close_application(%L,%L,%L,%L)',pg_temp.app(1),'rejected','Another reason','c-1'),'P0001','Closure idempotency conflict','A key reused with another reason conflicts');
select throws_ok(format('select public.vendor_close_application(%L,%L,%L,%L)',pg_temp.app(9),'rejected','Synthetic reason','c-1'),'P0001','Closure idempotency conflict','A key reused for another application conflicts');
select is(public.vendor_application_retention_overview(pg_temp.app(1))->'closure'->>'outcome','rejected','The overview reports the rejection');
select is((public.vendor_application_retention_overview(pg_temp.app(1))->'closure'->>'closed_at')::timestamptz,now(),'Its clock starts now');
select is(public.vendor_application_retention_overview(pg_temp.app(1))->>'closable','false','A closed application is not closable');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(1),pg_temp.path(1,'license',1),'quarantined','Synthetic reason','q-1'),
 'P0001','Documents of a closed application are kept for 90 days','A newly rejected application''s files are not due');
select is(public.vendor_close_application(pg_temp.app(9),'abandoned','Applicant stopped responding','c-9')->>'recorded','true','An operator marks an approved application abandoned');
select is(public.vendor_close_application(pg_temp.app(5),'rejected','Legacy rejection recorded','c-5')->>'recorded','true','A legacy rejection is recorded');
select is((select count(*) from jsonb_array_elements(public.vendor_application_retention_queue()->'unrecorded') e where e->>'application_id'=pg_temp.app(5)::text),0::bigint,
 'and leaves the unrecorded list');
select is(pg_temp.entry('due',pg_temp.path(5,'license',6)),null,'Its clock starts at the record, not the legacy status');
select throws_ok(format('select public.vendor_start_onboarding_review(%L,%L,%L,%L)',pg_temp.app(1),
 (select v from snap where k='version-1'),'Synthetic start','s-1'),
 'P0001','Closed application cannot start onboarding','A rejected application cannot start onboarding');
reset role;
select pg_temp.as_user('3');
set local role authenticated;
select throws_ok(format('select public.vendor_close_application(%L,%L,%L,%L)',pg_temp.app(1),'rejected','Synthetic reason','c-1'),'P0001','Closure idempotency conflict','Another operator cannot replay the key');
reset role;
select is((select string_agg(right(id::text,2)||':'||status,',' order by id) from public.vendor_applications where id in (pg_temp.app(1),pg_temp.app(5),pg_temp.app(9))),
 '01:rejected,05:rejected,09:abandoned','Closures set the application status');
select is((select count(*) from public.vendor_application_closures where application_id in (pg_temp.app(1),pg_temp.app(5),pg_temp.app(9))),3::bigint,'One closure row each');
select is((select before_status from public.vendor_application_closures where business_key='c-9'),'approved','A closure records the status it replaced');
select is((select count(*) from public.vendor_application_versions where application_id in (pg_temp.app(1),pg_temp.app(5),pg_temp.app(9)))::text,
 (select v from snap where k='versions'),'A closure creates no application version');

-- Prepare refusals.
insert into snap values('ledger-1',pg_temp.ledger());
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(4),pg_temp.path(4,'license',5),'quarantined','Synthetic reason','k-5'),
 'P0001','Documents of a closed application are kept for 90 days','A file one second short of 90 days is not due');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(10),pg_temp.path(10,'license',13),'quarantined','Synthetic reason','k-13'),
 'P0001','Only documents of a rejected or abandoned application are subject to retention','An open application''s file is not subject to retention');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(6),pg_temp.path(6,'license',7),'quarantined','Synthetic reason','k-7'),
 'P0001','Documents bound to compliance evidence are kept','A file bound to evidence is kept');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(2,'insurance',3),'quarantined','Synthetic reason','k-x'),
 'P0001','Document does not belong to this application','Another application''s file is refused');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(9),'synthetic/outside-layout.pdf','quarantined','Synthetic reason','k-x'),
 'P0001','Document does not belong to this application','A path outside the upload layout is refused');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)','b8600000-0000-4000-8000-000000000099',pg_temp.path(3,'license',4),'quarantined','Synthetic reason','k-x'),
 'P0001','Application not found','An unknown application is refused');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'purged','Synthetic reason','k-4'),
 'P0001','Unknown retention action','An unknown action is refused');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','  ','k-4'),
 'P0001','A reason is required','A reason is required');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'restored','Synthetic reason','k-4'),
 'P0001','Application document is not in quarantine','A retained file cannot be restored');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'deleted','Synthetic reason','k-4'),
 'P0001','Application document must be quarantined before deletion','A retained file cannot be deleted');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(7),pg_temp.path(7,'insurance',10),'deleted','Synthetic reason','k-10'),
 'P0001','Quarantined documents are kept for 14 days before deletion','A file one second short of 14 days in quarantine cannot be deleted');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(8),pg_temp.path(8,'license',11),'deleted','Synthetic reason','k-11'),
 'P0001','Only documents of a rejected or abandoned application are subject to retention','A reopened application''s quarantined file cannot be deleted');
select is(public.vendor_application_retention_prepare(pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','Synthetic reason','q-4'),
 jsonb_build_object('application_id',pg_temp.app(3),'action','quarantined','replay',false,'storage_path',pg_temp.path(3,'license',4),
   'from_bucket','vendor-documents','to_bucket','vendor-documents-quarantine'),'A due file is prepared for quarantine');
select is(public.vendor_application_retention_prepare(pg_temp.app(7),pg_temp.path(7,'license',9),'deleted','Synthetic reason','d-9')->'to_bucket','null'::jsonb,
 'A file exactly 14 days in quarantine is prepared for deletion, with no destination');
reset role;
select is(pg_temp.ledger(),(select v from snap where k='ledger-1'),'Preparing wrote nothing');

-- Record quarantine.
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_application_retention_record(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','Synthetic reason','q-4'),
 'P0001','Storage does not show this document in quarantine','Quarantine is not recorded before the file moves');
select throws_ok(format('select public.vendor_application_retention_record(%L,%L,%L,%L,%L)',pg_temp.app(4),pg_temp.path(4,'license',5),'quarantined','Synthetic reason','q-5'),
 'P0001','Documents of a closed application are kept for 90 days','Record re-checks the 90-day window');
reset role;
insert into storage.objects(bucket_id,name,metadata) values('vendor-documents-quarantine',pg_temp.path(3,'license',4),'{"size":2048,"mimetype":"application/pdf"}');
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_application_retention_record(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','Synthetic reason','q-4'),
 'P0001','Storage does not show this document in quarantine','A file still in the documents bucket is not recorded as quarantined');
select is(pg_temp.file(3,pg_temp.path(3,'license',4))->>'object_location','both','A file in both buckets is reported');
reset role;
select pg_temp.remove(pg_temp.path(3,'license',4));
insert into storage.objects(bucket_id,name,metadata) values('vendor-documents-quarantine',pg_temp.path(3,'license',4),'{"size":"2048x","mimetype":"application/pdf"}');
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_application_retention_record(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','Synthetic reason','q-4'),
 'P0001','Storage does not show this document in quarantine','A quarantined object without a readable size is not recorded');
reset role;
update storage.objects set metadata='{"size":3072,"mimetype":"application/pdf"}' where name=pg_temp.path(3,'license',4);
select pg_temp.as_user('1');
set local role authenticated;
select is(public.vendor_application_retention_record(pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','Synthetic reason ','q-4'),
 jsonb_build_object('application_id',pg_temp.app(3),'storage_path',pg_temp.path(3,'license',4),'action','quarantined','under_hold',false,'recorded',true),
 'Quarantine is recorded once the file is in quarantine');
select is(public.vendor_application_retention_record(pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','Synthetic reason','q-4')->>'recorded','false','The same request replays');
select is(public.vendor_application_retention_prepare(pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','Synthetic reason','q-4')->>'replay','true','Prepare reports a recorded key as a replay');
select throws_ok(format('select public.vendor_application_retention_record(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','Another reason','q-4'),
 'P0001','Retention idempotency conflict','A key reused with another reason conflicts');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(2),pg_temp.path(2,'insurance',3),'quarantined','Synthetic reason','q-4'),
 'P0001','Retention idempotency conflict','A key reused for another file conflicts at prepare');
select throws_ok(format('select public.vendor_application_retention_record(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','Synthetic reason','q-4b'),
 'P0001','Application document already quarantined','A quarantined file is not quarantined twice');
select is(pg_temp.entry('due',pg_temp.path(3,'license',4)),null,'A quarantined file leaves the due list');
select is(pg_temp.entry('quarantined',pg_temp.path(3,'license',4))->>'object_location','quarantine','and joins the quarantined list');
reset role;
select is((select size_bytes from public.vendor_application_retention_actions where business_key='q-4'),3072::bigint,'The quarantine records the size storage showed');
select pg_temp.as_user('3');
set local role authenticated;
select throws_ok(format('select public.vendor_application_retention_record(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','Synthetic reason','q-4'),
 'P0001','Retention idempotency conflict','Another operator cannot replay the key');
reset role;

-- Restore.
select pg_temp.move(pg_temp.path(3,'license',4),'vendor-documents');
update storage.objects set metadata='{"size":2048,"mimetype":"application/pdf"}' where name=pg_temp.path(3,'license',4);
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_application_retention_record(%L,%L,%L,%L,%L)',pg_temp.app(3),pg_temp.path(3,'license',4),'restored','Synthetic reason','r-4'),
 'P0001','Storage does not show this document restored','A restored file of another size is not recorded');
reset role;
update storage.objects set metadata='{"size":3072,"mimetype":"application/pdf"}' where name=pg_temp.path(3,'license',4);
select pg_temp.as_user('1');
set local role authenticated;
select is(public.vendor_application_retention_record(pg_temp.app(3),pg_temp.path(3,'license',4),'restored','Synthetic reason','r-4')->>'recorded','true','Restore is recorded once the file is back');
select is(pg_temp.entry('due',pg_temp.path(3,'license',4))->>'retention_state','retained','and, still past 90 days, the file is due again');
select is(public.vendor_application_retention_prepare(pg_temp.app(8),pg_temp.path(8,'license',11),'restored','Synthetic reason','r-11')->>'to_bucket','vendor-documents',
 'A reopened application''s quarantined file can be restored');
reset role;

-- Record deletion.
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_application_retention_record(%L,%L,%L,%L,%L)',pg_temp.app(7),pg_temp.path(7,'license',9),'deleted','Synthetic reason','d-9'),
 'P0001','Storage still holds this document','Deletion is not recorded while the file exists');
reset role;
select pg_temp.remove(pg_temp.path(7,'license',9));
select pg_temp.remove(pg_temp.path(7,'insurance',10));
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_application_retention_record(%L,%L,%L,%L,%L)',pg_temp.app(7),pg_temp.path(7,'insurance',10),'deleted','Synthetic reason','d-10'),
 'P0001','Quarantined documents are kept for 14 days before deletion','An early removal outside the workflow is not recorded as retention');
select is(public.vendor_application_retention_record(pg_temp.app(7),pg_temp.path(7,'license',9),'deleted','Synthetic reason','d-9')->>'recorded','true','Deletion is recorded once the file is gone');
select is(pg_temp.file(7,pg_temp.path(7,'license',9))->>'retention_state','deleted','The overview reports the deletion');
select is(pg_temp.file(7,pg_temp.path(7,'insurance',10))->>'object_location','missing','A file removed outside the workflow is reported missing');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(7),pg_temp.path(7,'license',9),'restored','Synthetic reason','r-9'),
 'P0001','Application document already deleted','A deleted file cannot be restored');
select is(pg_temp.entry('quarantined',pg_temp.path(7,'license',9)),null,'A deleted file leaves the queue');
reset role;
select throws_ok(format('insert into public.vendor_application_retention_actions(application_id,storage_path,action,reason,under_hold,business_key,actor) values(%L,%L,%L,%L,false,%L,%L)',
 pg_temp.app(7),pg_temp.path(7,'license',9),'deleted','x','dup-delete','b8400000-0000-4000-8000-000000000001'),'23505',null,'A file is deleted at most once');

-- Application holds.
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_place_application_retention_hold(%L,%L,%L)',pg_temp.app(2),' ','h-1'),'P0001','A reason is required','A hold needs a reason');
select throws_ok(format('select public.vendor_place_application_retention_hold(%L,%L,%L)',pg_temp.app(2),'Synthetic investigation',''),'P0001','Idempotency key required','A hold needs a key');
select throws_ok(format('select public.vendor_place_application_retention_hold(%L,%L,%L)','b8600000-0000-4000-8000-000000000099','Synthetic investigation','h-x'),'P0001','Application not found','A hold needs an application');
select throws_ok(format('select public.vendor_release_application_retention_hold(%L,%L,%L)',pg_temp.app(2),'Synthetic release','h-0'),'P0001','This application has no retention hold','Nothing to release without a hold');
select is(public.vendor_place_application_retention_hold(pg_temp.app(2),'Synthetic investigation ','h-1'),
 jsonb_build_object('application_id',pg_temp.app(2),'action','placed','recorded',true),'An operator places an application hold');
select is(public.vendor_place_application_retention_hold(pg_temp.app(2),'Synthetic investigation','h-1')->>'recorded','false','The same hold request replays');
select throws_ok(format('select public.vendor_release_application_retention_hold(%L,%L,%L)',pg_temp.app(2),'Synthetic investigation','h-1'),'P0001','Retention hold idempotency conflict','A hold key cannot be reused to release');
select throws_ok(format('select public.vendor_place_application_retention_hold(%L,%L,%L)',pg_temp.app(2),'Synthetic investigation','h-2'),'P0001','This application is already on a retention hold','A second hold is refused');
select is(public.vendor_application_retention_queue()->'holds',
 jsonb_build_array(jsonb_build_object('application_id',pg_temp.app(2),'business_name','Synthetic applicant 2','reason','Synthetic investigation','placed_at',now())),
 'The queue lists the hold with its trimmed reason');
select is(pg_temp.entry('due',pg_temp.path(2,'insurance',3))->>'held','true','A held application''s due file is marked held');
select is(public.vendor_application_retention_overview(pg_temp.app(2))->'hold'->>'reason','Synthetic investigation','The overview reports the hold');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(2),pg_temp.path(2,'insurance',3),'quarantined','Synthetic reason','q-3'),
 'P0001','This application is on a retention hold','A held application''s file cannot be quarantined');
reset role;
-- Quarantine prepared before the hold, moved and recorded after it: recorded, marked under hold.
select pg_temp.move(pg_temp.path(2,'insurance',3),'vendor-documents-quarantine');
select pg_temp.as_user('1');
set local role authenticated;
select is(public.vendor_application_retention_prepare(pg_temp.app(2),pg_temp.path(2,'insurance',3),'quarantined','Synthetic reason','q-3')->>'replay','false',
 'A hold does not refuse a quarantine storage already shows complete');
select is(public.vendor_application_retention_record(pg_temp.app(2),pg_temp.path(2,'insurance',3),'quarantined','Synthetic reason','q-3')->>'under_hold','true',
 'A quarantine that raced a hold is recorded under hold');
select is(public.vendor_application_retention_prepare(pg_temp.app(2),pg_temp.path(2,'insurance',3),'restored','Synthetic reason','r-3')->>'to_bucket','vendor-documents','Restoring is allowed under hold');
reset role;
insert into public.vendor_application_retention_actions(application_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor,created_at) values
 (pg_temp.app(2),pg_temp.path(2,'insurance',3),'restored',null,'Synthetic fixture',true,'fixture-r-3','b8400000-0000-4000-8000-000000000001',now()-interval '30 days'),
 (pg_temp.app(2),pg_temp.path(2,'insurance',3),'quarantined',2048,'Synthetic fixture',true,'fixture-q-3b','b8400000-0000-4000-8000-000000000001',now()-interval '20 days');
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(2),pg_temp.path(2,'insurance',3),'deleted','Synthetic reason','d-3'),
 'P0001','This application is on a retention hold','A held application''s file cannot be deleted');
select is(public.vendor_release_application_retention_hold(pg_temp.app(2),'Synthetic investigation closed','h-3')->>'recorded','true','An operator releases the hold');
select throws_ok(format('select public.vendor_release_application_retention_hold(%L,%L,%L)',pg_temp.app(2),'Synthetic investigation closed','h-4'),'P0001','This application has no retention hold','A released hold cannot be released again');
select is(public.vendor_application_retention_prepare(pg_temp.app(2),pg_temp.path(2,'insurance',3),'deleted','Synthetic reason','d-3')->>'replay','false','Deletion opens again after release');
select is(public.vendor_application_retention_queue()->'holds','[]'::jsonb,'A released hold leaves the queue');

-- A provider hold covers its applications' files.
select is(public.vendor_place_retention_hold('b8500000-0000-4000-8000-000000000006','Synthetic provider investigation','ph-1')->>'recorded','true','An operator places a provider hold');
select is(pg_temp.entry('due',pg_temp.path(6,'insurance',8))->>'held','true','The provider''s application file is marked held');
select is(public.vendor_application_retention_overview(pg_temp.app(6))->>'provider_held','true','The overview reports the provider hold');
select is(public.vendor_application_retention_overview(pg_temp.app(6))->'hold','null'::jsonb,'without an application hold');
select throws_ok(format('select public.vendor_application_retention_prepare(%L,%L,%L,%L,%L)',pg_temp.app(6),pg_temp.path(6,'insurance',8),'quarantined','Synthetic reason','q-8'),
 'P0001','This application is on a retention hold','A provider hold refuses quarantine of its application files');
reset role;

-- Nothing outside the retention ledger changed.
select is(pg_temp.state(),(select v from snap where k='state'),'Retention changed no application terms, version, evidence, onboarding, role or listing');

-- Evidence guard.
select throws_ok(format('insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by) select contractor_id,application_version_id,%L,%L,%L,now()-interval %L,now()+interval %L,%L from public.vendor_onboarding where contractor_id=%L',
 'license','license-v1',pg_temp.path(1,'license',1),'1 day','1 year','b8400000-0000-4000-8000-000000000001','b8500000-0000-4000-8000-000000000010'),
 'P0001','Documents of a rejected or abandoned application cannot become evidence','A closed application''s file cannot become evidence');
select throws_ok(format('insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by) select contractor_id,application_version_id,%L,%L,%L,now()-interval %L,now()+interval %L,%L from public.vendor_onboarding where contractor_id=%L',
 'insurance','insurance-v1',pg_temp.path(6,'insurance',8),'1 day','1 year','b8400000-0000-4000-8000-000000000001','b8500000-0000-4000-8000-000000000006'),
 'P0001','Documents of a rejected or abandoned application cannot become evidence','An onboarding-rejected application''s file cannot become evidence');
select throws_ok(format('insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by) select contractor_id,application_version_id,%L,%L,%L,now()-interval %L,now()+interval %L,%L from public.vendor_onboarding where contractor_id=%L',
 'license','license-v1',pg_temp.path(8,'license',11),'1 day','1 year','b8400000-0000-4000-8000-000000000001','b8500000-0000-4000-8000-000000000010'),
 'P0001','A document in retention quarantine cannot become evidence','A quarantined file of a reopened application cannot become evidence');
select lives_ok(format('insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by) select contractor_id,application_version_id,%L,%L,%L,now()-interval %L,now()+interval %L,%L from public.vendor_onboarding where contractor_id=%L',
 'license','license-v1',pg_temp.path(10,'license',13),'1 day','1 year','b8400000-0000-4000-8000-000000000001','b8500000-0000-4000-8000-000000000010'),
 'An open application''s file still becomes evidence');
select lives_ok($$insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select contractor_id,application_version_id,'identity','identity-v1','synthetic identity reference',now()-interval '1 day',null,'b8400000-0000-4000-8000-000000000001'
 from public.vendor_onboarding where contractor_id='b8500000-0000-4000-8000-000000000010'$$,'A reference that is not an application path is unaffected');

-- Immutability and constraints.
select throws_ok(format('update public.vendor_application_closures set reason=%L where business_key=%L','changed','c-1'),null,null,'Closures are immutable');
select throws_ok(format('update public.vendor_application_retention_actions set reason=%L where business_key=%L','changed','q-4'),null,null,'Retention actions are immutable');
select throws_ok(format('delete from public.vendor_application_retention_hold_events where business_key=%L','h-1'),null,null,'Hold events are immutable');
select throws_ok(format('insert into public.vendor_application_retention_actions(application_id,storage_path,action,reason,under_hold,business_key,actor) values(%L,%L,%L,%L,false,%L,%L)',
 pg_temp.app(3),pg_temp.path(2,'insurance',3),'restored','x','bad-path','b8400000-0000-4000-8000-000000000001'),'23514',null,'A stored step names a file in its application''s folder');
select throws_ok(format('insert into public.vendor_application_retention_actions(application_id,storage_path,action,reason,under_hold,business_key,actor) values(%L,%L,%L,%L,false,%L,%L)',
 pg_temp.app(3),pg_temp.path(3,'license',4),'quarantined','x','no-size','b8400000-0000-4000-8000-000000000001'),'23514',null,'A stored quarantine carries its size');
select throws_ok(format('insert into public.vendor_application_closures(application_id,outcome,before_status,reason,business_key,actor) values(%L,%L,%L,%L,%L,%L)',
 pg_temp.app(10),'approved','pending','x','bad-outcome','b8400000-0000-4000-8000-000000000001'),'23514',null,'A stored closure is rejected or abandoned');

select * from finish();
rollback;
