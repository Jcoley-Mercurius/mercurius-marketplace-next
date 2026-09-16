begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-074 synthetic fixtures only. Covers CFG-011 retention of declined renewal
-- documents: the 90-day window, quarantine, restore, permanent deletion after 14 days,
-- provider retention holds, storage verification and the readbacks. Storage objects are
-- synthetic rows with metadata only, moved here the way the Storage API moves them; no
-- file, real provider, account or document is represented.
insert into auth.users(id,email,email_confirmed_at) values
 ('b7400000-0000-4000-8000-000000000001','retention-operator@example.invalid',now()),
 ('b7400000-0000-4000-8000-000000000002','retention-vendor@example.invalid',now()),
 ('b7400000-0000-4000-8000-000000000003','retention-operator-two@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b7400000-0000-4000-8000-000000000001','admin'),
 ('b7400000-0000-4000-8000-000000000002','vendor'),
 ('b7400000-0000-4000-8000-000000000003','admin');
-- A active (linked to the vendor account), B suspended.
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b7500000-0000-4000-8000-000000000001','Synthetic retention A',true,false,'b7400000-0000-4000-8000-000000000002'),
 ('b7500000-0000-4000-8000-000000000002','Synthetic retention B',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls)
 select ('b7600000-0000-4000-8000-00000000000'||n)::uuid,'Synthetic retention '||n,'Test','Retention',
   'retention-'||n||'@example.invalid','synthetic',('b7500000-0000-4000-8000-00000000000'||n)::uuid,
   array['synthetic/b74'||n||'/license.pdf']
 from generate_series(1,2) n;
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select ('b7500000-0000-4000-8000-00000000000'||n)::uuid,
   (select id from public.vendor_application_versions where application_id=('b7600000-0000-4000-8000-00000000000'||n)::uuid),
   2,case n when 1 then 'active' else 'suspended' end
 from generate_series(1,2) n;
insert into public.vendor_compliance_evidence(id,contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select 'b7700000-0000-4000-8000-000000000001',o.contractor_id,o.application_version_id,'license','license-v1','synthetic/b741/license.pdf',
   now()-interval '10 days',now()+interval '1 year','b7400000-0000-4000-8000-000000000001'
 from public.vendor_onboarding o where o.contractor_id='b7500000-0000-4000-8000-000000000001';

create function pg_temp.path(p_contractor text,p_kind text,p_n integer) returns text language sql as $$
 select 'renewals/b7500000-0000-4000-8000-00000000000'||p_contractor||'/'||p_kind||'/'||
   'c7400000-0000-4000-8000-'||lpad(p_n::text,12,'0')||'-retention-'||p_kind||'.pdf' $$;
create function pg_temp.doc(p_n integer) returns uuid language sql as $$
 select ('d7400000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
-- A submission with its stored object, and optionally a decision made p_age ago.
create function pg_temp.fixture(p_n integer,p_contractor text,p_kind text,p_outcome text,p_age interval) returns void language plpgsql as $$
begin
 insert into storage.objects(bucket_id,name,metadata)
   values('vendor-documents',pg_temp.path(p_contractor,p_kind,p_n),jsonb_build_object('size',2048,'mimetype','application/pdf'));
 insert into public.vendor_renewal_documents(id,contractor_id,kind,storage_path,file_name,mime_type,size_bytes,submitted_by,submitted_as,created_at)
   values(pg_temp.doc(p_n),('b7500000-0000-4000-8000-00000000000'||p_contractor)::uuid,p_kind,pg_temp.path(p_contractor,p_kind,p_n),
     'retention-'||p_kind||'.pdf','application/pdf',2048,'b7400000-0000-4000-8000-000000000002','provider',now()-p_age-interval '1 day');
 if p_outcome='declined' then
   insert into public.vendor_renewal_document_decisions(document_id,outcome,note,business_key,actor,created_at)
     values(pg_temp.doc(p_n),'declined','Synthetic decline','fixture-decline-'||p_n,'b7400000-0000-4000-8000-000000000001',now()-p_age);
 elsif p_outcome='accepted' then
   insert into public.vendor_renewal_document_decisions(document_id,outcome,evidence_id,business_key,actor,created_at)
     values(pg_temp.doc(p_n),'accepted','b7700000-0000-4000-8000-000000000001','fixture-accept-'||p_n,'b7400000-0000-4000-8000-000000000001',now()-p_age);
 end if;
end $$;
-- Storage API equivalents: move between buckets, and delete.
create function pg_temp.move(p_n integer,p_contractor text,p_kind text,p_to text) returns void language sql as $$
 update storage.objects set bucket_id=p_to where name=pg_temp.path(p_contractor,p_kind,p_n) $$;
create function pg_temp.remove(p_n integer,p_contractor text,p_kind text) returns void language plpgsql as $$
begin
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where name=pg_temp.path(p_contractor,p_kind,p_n);
 perform set_config('storage.allow_delete_query','false',true);
end $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7400000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.entry(p_list text,p_n integer) returns jsonb language sql as $$
 select e from jsonb_array_elements(public.vendor_document_retention_queue()->p_list) e where e->>'id'=pg_temp.doc(p_n)::text $$;
create function pg_temp.overview_doc(p_contractor text,p_n integer) returns jsonb language sql as $$
 select d from jsonb_array_elements(public.vendor_renewal_document_overview(('b7500000-0000-4000-8000-00000000000'||p_contractor)::uuid)->'documents') d
 where d->>'id'=pg_temp.doc(p_n)::text $$;
-- Everything retention must never change.
create function pg_temp.state() returns text language sql as $$ select md5(concat_ws('|',
 (select string_agg(id::text||storage_path,',' order by id) from public.vendor_renewal_documents),
 (select string_agg(document_id::text||outcome,',' order by document_id) from public.vendor_renewal_document_decisions),
 (select count(*) from public.vendor_compliance_evidence),
 (select string_agg(contractor_id||':'||status||':'||revision,',' order by contractor_id) from public.vendor_onboarding),
 (select count(*) from public.vendor_onboarding_events),
 (select count(*) from public.vendor_application_versions),
 (select count(*) from public.user_roles),
 (select string_agg(id||':'||coalesce(is_active::text,'null')||':'||marketing_enabled::text,',' order by id) from public.contractors))) $$;
create function pg_temp.ledger() returns text language sql as $$ select md5(concat_ws('|',
 (select count(*) from public.vendor_renewal_retention_actions),(select count(*) from public.vendor_retention_hold_events),
 (select string_agg(bucket_id||name,',' order by bucket_id,name) from storage.objects where name like 'renewals/b7500000-%'))) $$;
create temp table snap(k text primary key,v text);
grant all on snap to authenticated;

-- 1: A license, declined exactly 90 days ago (due). 2: A insurance, one second short (not due).
-- 3: A license, undecided. 4: A license, accepted. 5: B insurance, declined 100 days (hold).
-- 6: A license, quarantined exactly 14 days ago. 7: A insurance, quarantined one second short.
-- 8: A insurance, declined 95 days, size changed in quarantine. 9: B license, quarantined 20 days.
-- 10: A license, declined 91 days, file removed outside the workflow.
select pg_temp.fixture(1,'1','license','declined',interval '90 days');
select pg_temp.fixture(2,'1','insurance','declined',interval '90 days'-interval '1 second');
select pg_temp.fixture(3,'1','license',null,interval '120 days');
select pg_temp.fixture(4,'1','license','accepted',interval '120 days');
select pg_temp.fixture(5,'2','insurance','declined',interval '100 days');
select pg_temp.fixture(6,'1','license','declined',interval '130 days');
select pg_temp.fixture(7,'1','insurance','declined',interval '130 days');
select pg_temp.fixture(8,'1','insurance','declined',interval '95 days');
select pg_temp.fixture(9,'2','license','declined',interval '130 days');
select pg_temp.fixture(10,'1','license','declined',interval '91 days');
select pg_temp.move(6,'1','license','vendor-documents-quarantine');
select pg_temp.move(7,'1','insurance','vendor-documents-quarantine');
select pg_temp.move(9,'2','license','vendor-documents-quarantine');
select pg_temp.remove(10,'1','license');
insert into public.vendor_renewal_retention_actions(document_id,action,reason,under_hold,business_key,actor,created_at) values
 (pg_temp.doc(6),'quarantined','Synthetic fixture',false,'fixture-q-6','b7400000-0000-4000-8000-000000000001',now()-interval '14 days'),
 (pg_temp.doc(7),'quarantined','Synthetic fixture',false,'fixture-q-7','b7400000-0000-4000-8000-000000000001',now()-interval '14 days'+interval '1 second'),
 (pg_temp.doc(9),'quarantined','Synthetic fixture',false,'fixture-q-9','b7400000-0000-4000-8000-000000000001',now()-interval '20 days');
insert into snap values('state',pg_temp.state());

-- Quarantine bucket.
select ok(exists(select 1 from storage.buckets where id='vendor-documents-quarantine' and not public),'The quarantine bucket exists and is private');
select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
 and (coalesce(qual,'')||coalesce(with_check,'')) like '%vendor-documents-quarantine%'),'No storage policy grants any client the quarantine bucket');
select pg_temp.as_user('1');
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='vendor-documents-quarantine'),0::bigint,'An operator client cannot list quarantined files');
select throws_ok(format('insert into storage.objects(bucket_id,name) values(%L,%L)','vendor-documents-quarantine',pg_temp.path('1','license',90)),
 '42501',null,'An operator client cannot write into quarantine');
select throws_ok(format('update storage.objects set bucket_id=%L where bucket_id=%L and name=%L','vendor-documents-quarantine','vendor-documents',pg_temp.path('1','license',1)),
 '42501',null,'An operator client cannot move a file into quarantine');
reset role;
select is((select bucket_id from storage.objects where name=pg_temp.path('1','license',1)),'vendor-documents','The admin update policy cannot move a file into quarantine');

-- Access.
set local role anon;
select throws_ok($$select public.vendor_document_retention_queue()$$,'42501','permission denied for function vendor_document_retention_queue','Anonymous caller cannot read the retention queue');
select throws_ok($$select public.vendor_record_renewal_retention(null,'deleted','x','x')$$,'42501','permission denied for function vendor_record_renewal_retention','Anonymous caller cannot record retention');
reset role;
set local role service_role;
select throws_ok($$select public.vendor_prepare_renewal_retention(null,'deleted','x','x')$$,'42501','permission denied for function vendor_prepare_renewal_retention','Service role cannot prepare retention');
select throws_ok($$select public.vendor_place_retention_hold(null,'x','x')$$,'42501','permission denied for function vendor_place_retention_hold','Service role cannot place a hold');
reset role;
set local role authenticated;
select throws_ok($$select private.vendor_document_retention_days()$$,'42501','permission denied for schema private','Retention helpers are not client functions');
select throws_ok($$select count(*) from public.vendor_renewal_retention_actions$$,'42501','permission denied for table vendor_renewal_retention_actions','Clients cannot read retention actions');
select throws_ok($$select count(*) from public.vendor_retention_hold_events$$,'42501','permission denied for table vendor_retention_hold_events','Clients cannot read hold events');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select public.vendor_document_retention_queue()$$,'42501','Onboarding operator required','A vendor cannot read the retention queue');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(1),'quarantined','x','vendor-key'),'42501','Onboarding operator required','A vendor cannot prepare retention');
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(1),'quarantined','x','vendor-key'),'42501','Onboarding operator required','A vendor cannot record retention');
select throws_ok($$select public.vendor_place_retention_hold('b7500000-0000-4000-8000-000000000001','x','vendor-key')$$,'42501','Onboarding operator required','A vendor cannot place a hold');
select throws_ok($$select public.vendor_release_retention_hold('b7500000-0000-4000-8000-000000000001','x','vendor-key')$$,'42501','Onboarding operator required','A vendor cannot release a hold');
select is((select array_agg(k order by k) from jsonb_object_keys((select d from jsonb_array_elements(public.vendor_own_renewal_documents()->'documents') d where d->>'id'=pg_temp.doc(1)::text)) k),
 array['created_at','decided_at','file_name','id','kind','note','state','submitted_as'],'The vendor readback carries no retention or storage fields');
reset role;

-- Queue before any step.
insert into snap values('ledger-0',pg_temp.ledger());
select pg_temp.as_user('1');
set local role authenticated;
select is((select string_agg(right(e->>'id',2),',' order by e->>'id') from jsonb_array_elements(public.vendor_document_retention_queue()->'due') e where e->>'id' like 'd7400000-%'),
 '01,05,08,10','Due lists declined documents at or past 90 days still in the documents bucket');
select is((select string_agg(right(e->>'id',2),',' order by e->>'id') from jsonb_array_elements(public.vendor_document_retention_queue()->'quarantined') e where e->>'id' like 'd7400000-%'),
 '06,07,09','Quarantined lists documents in quarantine');
select is(pg_temp.entry('due',1)->>'object_location','documents','A due entry reports where the file is');
select is(pg_temp.entry('due',10)->>'object_location','missing','A file removed outside the workflow is reported missing');
select is((pg_temp.entry('due',1)->>'retention_ends_at')::timestamptz,now(),'The retention window ends 90 days after the decline');
select is((pg_temp.entry('quarantined',6)->>'quarantine_ends_at')::timestamptz,now(),'Quarantine ends 14 days after the quarantine');
select is((public.vendor_document_retention_queue()->>'retention_days')::int*100+(public.vendor_document_retention_queue()->>'quarantine_days')::int,9014,'The queue reports 90 and 14 days');
select is(public.vendor_document_retention_queue()->'holds','[]'::jsonb,'No holds are in force');
select is(pg_temp.entry('due',1)->>'held','false','A due entry reports no hold');
reset role;
select is(pg_temp.ledger(),(select v from snap where k='ledger-0'),'Reading the queue wrote nothing');

-- Prepare refusals.
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(2),'quarantined','Synthetic reason','k-2'),
 'P0001','Declined documents are kept for 90 days','A declined document one second short of 90 days is not due');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(3),'quarantined','Synthetic reason','k-3'),
 'P0001','Only declined renewal documents are subject to retention','An undecided document is not subject to retention');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(4),'quarantined','Synthetic reason','k-4'),
 'P0001','Only declined renewal documents are subject to retention','An accepted document is not subject to retention');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)','d7400000-0000-4000-8000-000000000099','quarantined','Synthetic reason','k-99'),
 'P0001','Renewal document not found','An unknown document is refused');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(1),'purged','Synthetic reason','k-1'),
 'P0001','Unknown retention action','An unknown action is refused');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(1),'quarantined','  ','k-1'),
 'P0001','A reason is required','A reason is required');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(1),'quarantined','Synthetic reason',' '),
 'P0001','Idempotency key required','A key is required');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(1),'restored','Synthetic reason','k-1'),
 'P0001','Renewal document is not in quarantine','A retained document cannot be restored');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(1),'deleted','Synthetic reason','k-1'),
 'P0001','Renewal document must be quarantined before deletion','A retained document cannot be deleted');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(7),'deleted','Synthetic reason','k-7'),
 'P0001','Quarantined documents are kept for 14 days before deletion','A document one second short of 14 days in quarantine cannot be deleted');
select is(public.vendor_prepare_renewal_retention(pg_temp.doc(1),'quarantined','Synthetic reason','q-1'),
 jsonb_build_object('document_id',pg_temp.doc(1),'action','quarantined','replay',false,'storage_path',pg_temp.path('1','license',1),
   'from_bucket','vendor-documents','to_bucket','vendor-documents-quarantine'),'A due document is prepared for quarantine');
select is(public.vendor_prepare_renewal_retention(pg_temp.doc(6),'deleted','Synthetic reason','d-6')->>'from_bucket','vendor-documents-quarantine',
 'A document exactly 14 days in quarantine is prepared for deletion');
select ok((public.vendor_prepare_renewal_retention(pg_temp.doc(6),'deleted','Synthetic reason','d-6') ? 'to_bucket')
 and public.vendor_prepare_renewal_retention(pg_temp.doc(6),'deleted','Synthetic reason','d-6')->'to_bucket'='null'::jsonb,'Deletion has no destination bucket');
reset role;
select is(pg_temp.ledger(),(select v from snap where k='ledger-0'),'Preparing wrote nothing');

-- Record quarantine.
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(1),'quarantined','Synthetic reason','q-1'),
 'P0001','Storage does not show this document in quarantine','Quarantine is not recorded before the file moves');
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(10),'quarantined','Synthetic reason','q-10'),
 'P0001','Storage does not show this document in quarantine','A missing file cannot be recorded as quarantined');
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(2),'quarantined','Synthetic reason','q-2'),
 'P0001','Declined documents are kept for 90 days','Record re-checks the 90-day window');
reset role;
select pg_temp.move(8,'1','insurance','vendor-documents-quarantine');
update storage.objects set metadata=jsonb_set(metadata,'{size}','4096') where name=pg_temp.path('1','insurance',8);
insert into storage.objects(bucket_id,name,metadata) values('vendor-documents-quarantine',pg_temp.path('1','license',1),'{"size":2048,"mimetype":"application/pdf"}');
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(8),'quarantined','Synthetic reason','q-8'),
 'P0001','Storage does not show this document in quarantine','A quarantined object of a different size is not recorded');
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(1),'quarantined','Synthetic reason','q-1'),
 'P0001','Storage does not show this document in quarantine','A file still in the documents bucket is not recorded as quarantined');
select is(pg_temp.overview_doc('1',1)->>'object_location','both','A file in both buckets is reported');
reset role;
select pg_temp.remove(1,'1','license');
insert into storage.objects(bucket_id,name,metadata) values('vendor-documents-quarantine',pg_temp.path('1','license',1),'{"size":2048,"mimetype":"application/pdf"}');
select pg_temp.as_user('1');
set local role authenticated;
select is(public.vendor_record_renewal_retention(pg_temp.doc(1),'quarantined','Synthetic reason ','q-1'),
 jsonb_build_object('document_id',pg_temp.doc(1),'action','quarantined','under_hold',false,'recorded',true),'Quarantine is recorded once the file is in quarantine');
select is(public.vendor_record_renewal_retention(pg_temp.doc(1),'quarantined','Synthetic reason','q-1'),
 jsonb_build_object('document_id',pg_temp.doc(1),'action','quarantined','under_hold',false,'recorded',false),'The same request replays');
select is(public.vendor_prepare_renewal_retention(pg_temp.doc(1),'quarantined','Synthetic reason','q-1')->>'replay','true','Prepare reports a recorded key as a replay');
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(1),'quarantined','Another reason','q-1'),
 'P0001','Retention idempotency conflict','A key reused with another reason conflicts');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(5),'quarantined','Synthetic reason','q-1'),
 'P0001','Retention idempotency conflict','A key reused for another document conflicts at prepare');
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(1),'quarantined','Synthetic reason','q-1b'),
 'P0001','Renewal document already quarantined','A quarantined document is not quarantined twice');
select is(pg_temp.overview_doc('1',1)->>'retention_state','quarantined','The overview reports the quarantine');
select is(pg_temp.entry('due',1),null,'A quarantined document leaves the due list');
select is(pg_temp.entry('quarantined',1)->>'object_location','quarantine','and joins the quarantined list');
reset role;
select pg_temp.as_user('3');
set local role authenticated;
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(1),'quarantined','Synthetic reason','q-1'),
 'P0001','Retention idempotency conflict','Another operator cannot replay the key');
reset role;
select is((select count(*) from public.vendor_renewal_retention_actions where document_id=pg_temp.doc(1)),1::bigint,'One quarantine row was written');

-- Record deletion.
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(6),'deleted','Synthetic reason','d-6'),
 'P0001','Storage still holds this document','Deletion is not recorded while the file exists');
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(7),'deleted','Synthetic reason','d-7'),
 'P0001','Quarantined documents are kept for 14 days before deletion','Record re-checks the quarantine period');
reset role;
select pg_temp.remove(6,'1','license');
select pg_temp.remove(7,'1','insurance');
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(7),'deleted','Synthetic reason','d-7'),
 'P0001','Quarantined documents are kept for 14 days before deletion','An early removal outside the workflow is still not recorded as retention');
select is(public.vendor_record_renewal_retention(pg_temp.doc(6),'deleted','Synthetic reason','d-6')->>'recorded','true','Deletion is recorded once the file is gone');
select is(pg_temp.overview_doc('1',6)->>'retention_state','deleted','The overview reports the deletion');
select is(pg_temp.overview_doc('1',6)->>'state','declined','The decline is unchanged');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(6),'restored','Synthetic reason','r-6'),
 'P0001','Renewal document already deleted','A deleted document cannot be restored');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(6),'quarantined','Synthetic reason','q-6'),
 'P0001','Renewal document already deleted','A deleted document cannot be quarantined');
select is(pg_temp.entry('quarantined',6),null,'A deleted document leaves the queue');
select is(pg_temp.entry('due',6),null,'and does not return to the due list');
reset role;
select throws_ok(format('insert into public.vendor_renewal_retention_actions(document_id,action,reason,under_hold,business_key,actor) values(%L,%L,%L,false,%L,%L)',
 pg_temp.doc(6),'deleted','x','dup-delete','b7400000-0000-4000-8000-000000000001'),'23505',null,'A document is deleted at most once');

-- Restore.
select pg_temp.as_user('1');
set local role authenticated;
select is(public.vendor_prepare_renewal_retention(pg_temp.doc(9),'restored','Synthetic reason','r-9')->>'to_bucket','vendor-documents','Restore moves back to the documents bucket');
select throws_ok(format('select public.vendor_record_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(9),'restored','Synthetic reason','r-9'),
 'P0001','Storage does not show this document restored','Restore is not recorded before the file moves back');
reset role;
select pg_temp.move(9,'2','license','vendor-documents');
select pg_temp.as_user('1');
set local role authenticated;
select is(public.vendor_record_renewal_retention(pg_temp.doc(9),'restored','Synthetic reason','r-9')->>'recorded','true','Restore is recorded once the file is back');
select is(pg_temp.overview_doc('2',9)->>'retention_state','retained','A restored document is retained');
select is(pg_temp.entry('due',9)->>'object_location','documents','and, still past 90 days, is due again');
select is(public.vendor_prepare_renewal_retention(pg_temp.doc(9),'quarantined','Synthetic reason','q-9b')->>'replay','false','A restored document may be quarantined again');
reset role;

-- Holds.
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select public.vendor_place_retention_hold('b7500000-0000-4000-8000-000000000002',' ','h-1')$$,'P0001','A reason is required','A hold needs a reason');
select throws_ok($$select public.vendor_place_retention_hold('b7500000-0000-4000-8000-000000000002','Synthetic investigation','')$$,'P0001','Idempotency key required','A hold needs a key');
select throws_ok($$select public.vendor_place_retention_hold('b7500000-0000-4000-8000-000000000099','Synthetic investigation','h-x')$$,'P0001','Onboarding review required','A hold needs a provider under onboarding');
select throws_ok($$select public.vendor_release_retention_hold('b7500000-0000-4000-8000-000000000002','Synthetic release','h-0')$$,'P0001','This provider has no retention hold','Nothing to release without a hold');
select is(public.vendor_place_retention_hold('b7500000-0000-4000-8000-000000000002','Synthetic investigation ','h-1'),
 '{"action":"placed","recorded":true,"contractor_id":"b7500000-0000-4000-8000-000000000002"}'::jsonb,'An operator places a hold');
select is(public.vendor_place_retention_hold('b7500000-0000-4000-8000-000000000002','Synthetic investigation','h-1')->>'recorded','false','The same hold request replays');
select throws_ok($$select public.vendor_release_retention_hold('b7500000-0000-4000-8000-000000000002','Synthetic investigation','h-1')$$,'P0001','Retention hold idempotency conflict','A hold key cannot be reused to release');
select throws_ok($$select public.vendor_place_retention_hold('b7500000-0000-4000-8000-000000000002','Synthetic investigation','h-2')$$,'P0001','This provider is already on a retention hold','A second hold is refused');
select is(public.vendor_document_retention_queue()->'holds',
 jsonb_build_array(jsonb_build_object('contractor_id','b7500000-0000-4000-8000-000000000002','name','Synthetic retention B','reason','Synthetic investigation','placed_at',now())),
 'The queue lists the hold with its trimmed reason');
select is(pg_temp.entry('due',5)->>'held','true','A held provider''s due document is marked held');
select is(public.vendor_renewal_document_overview('b7500000-0000-4000-8000-000000000002')->'retention_hold'->>'reason','Synthetic investigation','The overview reports the hold');
select is(public.vendor_renewal_document_overview('b7500000-0000-4000-8000-000000000001')->'retention_hold','null'::jsonb,'Another provider has no hold');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(5),'quarantined','Synthetic reason','q-5'),
 'P0001','This provider is on a retention hold','A held provider''s document cannot be quarantined');
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(9),'quarantined','Synthetic reason','q-9b'),
 'P0001','This provider is on a retention hold','Hold refusal applies to every document of the provider');
reset role;
-- Quarantine prepared before the hold, moved and recorded after it: recorded, marked under hold.
select pg_temp.move(5,'2','insurance','vendor-documents-quarantine');
select pg_temp.as_user('1');
set local role authenticated;
select is(public.vendor_prepare_renewal_retention(pg_temp.doc(5),'quarantined','Synthetic reason','q-5')->>'replay','false',
 'A hold does not refuse a quarantine storage already shows complete');
select is(public.vendor_record_renewal_retention(pg_temp.doc(5),'quarantined','Synthetic reason','q-5'),
 jsonb_build_object('document_id',pg_temp.doc(5),'action','quarantined','under_hold',true,'recorded',true),'A quarantine that raced a hold is recorded under hold');
select is(public.vendor_prepare_renewal_retention(pg_temp.doc(5),'restored','Synthetic reason','r-5')->>'to_bucket','vendor-documents','Restoring is allowed under hold');
reset role;
insert into public.vendor_renewal_retention_actions(document_id,action,reason,under_hold,business_key,actor,created_at)
 values(pg_temp.doc(5),'restored','Synthetic fixture',true,'fixture-r-5','b7400000-0000-4000-8000-000000000001',now()-interval '30 days'),
       (pg_temp.doc(5),'quarantined','Synthetic fixture',true,'fixture-q-5b','b7400000-0000-4000-8000-000000000001',now()-interval '20 days');
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_prepare_renewal_retention(%L,%L,%L,%L)',pg_temp.doc(5),'deleted','Synthetic reason','d-5'),
 'P0001','This provider is on a retention hold','A held provider''s document cannot be deleted');
select is(pg_temp.entry('quarantined',5)->>'held','true','A held quarantined document is marked held');
reset role;
select pg_temp.remove(5,'2','insurance');
select pg_temp.as_user('1');
set local role authenticated;
select is(public.vendor_prepare_renewal_retention(pg_temp.doc(5),'deleted','Synthetic reason','d-5')->>'replay','false',
 'A hold does not refuse a deletion storage already shows complete');
select is(public.vendor_record_renewal_retention(pg_temp.doc(5),'deleted','Synthetic reason','d-5')->>'under_hold','true',
 'That deletion is recorded under hold');
select is(public.vendor_release_retention_hold('b7500000-0000-4000-8000-000000000002','Synthetic investigation closed','h-3')->>'recorded','true','An operator releases the hold');
select throws_ok($$select public.vendor_release_retention_hold('b7500000-0000-4000-8000-000000000002','Synthetic investigation closed','h-4')$$,'P0001','This provider has no retention hold','A released hold cannot be released again');
select is(public.vendor_prepare_renewal_retention(pg_temp.doc(9),'quarantined','Synthetic reason','q-9b')->>'replay','false','Quarantine opens again after release');
select is(public.vendor_document_retention_queue()->'holds','[]'::jsonb,'A released hold leaves the queue');
select is(public.vendor_place_retention_hold('b7500000-0000-4000-8000-000000000002','Synthetic second investigation','h-5')->>'recorded','true','A hold can be placed again after release');
select is((select count(*) from jsonb_array_elements(public.vendor_document_retention_queue()->'holds')),1::bigint,'Only the hold in force is listed');
reset role;

-- Readbacks and undecided/accepted documents.
select pg_temp.as_user('1');
set local role authenticated;
select ok(not (pg_temp.overview_doc('1',3) ? 'retention_state') and not (pg_temp.overview_doc('1',4) ? 'retention_state'),
 'Undecided and accepted documents carry no retention fields');
select is(pg_temp.overview_doc('1',2)->>'retention_state','retained','A declined document inside the window is retained');
reset role;

-- Nothing outside the retention ledger changed.
select is(pg_temp.state(),(select v from snap where k='state'),'Retention changed no submission, decision, evidence, status, revision, role or listing');

-- Immutability and constraints.
select throws_ok(format('update public.vendor_renewal_retention_actions set reason=%L where business_key=%L','changed','q-1'),null,null,'Retention actions are immutable');
select throws_ok(format('delete from public.vendor_retention_hold_events where business_key=%L','h-1'),null,null,'Hold events are immutable');
select throws_ok(format('insert into public.vendor_retention_hold_events(contractor_id,action,reason,business_key,actor) values(%L,%L,%L,%L,%L)',
 'b7500000-0000-4000-8000-000000000001','placed',' ','bad-reason','b7400000-0000-4000-8000-000000000001'),'23514',null,'A stored hold needs a reason');
select throws_ok(format('insert into public.vendor_renewal_retention_actions(document_id,action,reason,under_hold,business_key,actor) values(%L,%L,%L,false,%L,%L)',
 pg_temp.doc(2),'purged','x','bad-action','b7400000-0000-4000-8000-000000000001'),'23514',null,'A stored action must be known');

select * from finish();
rollback;
