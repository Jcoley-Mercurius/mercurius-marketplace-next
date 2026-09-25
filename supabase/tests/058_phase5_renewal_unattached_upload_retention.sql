begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-091 synthetic fixtures only. Covers retention of renewal uploads never submitted
-- (DEC-2026-015): due 7 days after the 2-hour upload grant expires, measured from the
-- object's creation; submissions refused from 7 days so they never race a quarantine; the
-- evidence exemption and guard; provider holds; and TRACE-074's quarantine, restore and
-- deletion steps applied to these files. Storage objects are synthetic rows with metadata
-- only; no file, real provider, account or document is represented.
insert into auth.users(id,email,email_confirmed_at) values
 ('b9100000-0000-4000-8000-000000000001','renewal-upload-operator@example.invalid',now()),
 ('b9100000-0000-4000-8000-000000000002','renewal-upload-vendor@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b9100000-0000-4000-8000-000000000001','admin'),
 ('b9100000-0000-4000-8000-000000000002','vendor');

create function pg_temp.provider(p_n integer) returns uuid language sql as $$
 select ('b9200000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
create function pg_temp.path(p_provider integer,p_kind text,p_n integer) returns text language sql as $$
 select 'renewals/'||pg_temp.provider(p_provider)::text||'/'||p_kind||'/c9100000-0000-4000-8000-'||lpad(p_n::text,12,'0')||'-synthetic-'||p_kind||'.pdf' $$;
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
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9100000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.step(p_fn text,p_path text,p_action text,p_key text) returns jsonb language plpgsql as $$
declare result jsonb;
begin
 execute format('select public.%I(%L,%L,%L,%L)',p_fn,p_path,p_action,'Synthetic renewal upload step',p_key) into result;
 return result;
end $$;
create function pg_temp.listed(p_list text) returns text language sql as $$
 select coalesce(string_agg(right(split_part(e->>'path','/',2),1)||':'||split_part(e->>'path','/',3)||':'||substr(split_part(e->>'path','/',4),35,2),',' order by e->>'path'),'')
 from jsonb_array_elements(public.vendor_document_retention_queue()->p_list) e where e->>'path' like 'renewals/b9200000-%' $$;
create function pg_temp.entry(p_list text,p_path text) returns jsonb language sql as $$
 select e from jsonb_array_elements(public.vendor_document_retention_queue()->p_list) e where e->>'path'=p_path $$;
create function pg_temp.ledger() returns bigint language sql as $$
 select count(*) from public.vendor_renewal_upload_retention_actions where contractor_id::text like 'b9200000-%' $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- Active providers 1-4, each on a synthetic application version.
-- Provider 1's vendor account is user 2.
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 (pg_temp.provider(1),'Synthetic renewal provider',false,false,'b9100000-0000-4000-8000-000000000002'),
 (pg_temp.provider(2),'Synthetic held renewal provider',false,false,null),
 (pg_temp.provider(3),'Synthetic evidence renewal provider',false,false,null),
 (pg_temp.provider(4),'Synthetic other renewal provider',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls,contractor_id)
 select ('b9300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic renewal application '||n,'Test','Applicant',
   'renewal-upload-'||n||'@example.invalid','synthetic','approved','{}',pg_temp.provider(n)
 from generate_series(1,4) n;
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select pg_temp.provider(n),(select id from public.vendor_application_versions
   where application_id=('b9300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid order by revision desc limit 1),3,'active'
 from generate_series(1,4) n;

-- 1: 01 just due, 02 one minute short, 03 exactly due, 04 submitted (a document row),
--    05 six days old (submittable), 06 exactly 7 days old (no longer submittable),
--    and a file outside the layout.
select pg_temp.stored(pg_temp.path(1,'license',1),interval '7 days 2 hours 1 minute');
select pg_temp.stored(pg_temp.path(1,'insurance',2),interval '7 days 2 hours'-interval '1 minute');
select pg_temp.stored(pg_temp.path(1,'license',3),interval '7 days 2 hours');
select pg_temp.stored(pg_temp.path(1,'license',4),interval '30 days');
insert into public.vendor_renewal_documents(contractor_id,kind,storage_path,file_name,mime_type,size_bytes,submitted_by,submitted_as)
 values(pg_temp.provider(1),'license',pg_temp.path(1,'license',4),'synthetic-license.pdf','application/pdf',2048,
   'b9100000-0000-4000-8000-000000000001','operator');
select pg_temp.stored(pg_temp.path(1,'insurance',5),interval '6 days');
select pg_temp.stored(pg_temp.path(1,'insurance',6),interval '7 days');
select pg_temp.stored('renewals/'||pg_temp.provider(1)::text||'/license/notes.txt',interval '60 days');
-- 2: provider hold. 3: an unsubmitted upload bound to evidence (recorded directly, as
--    the kernel allows). 4: already quarantined 15 and 13 days ago.
select pg_temp.stored(pg_temp.path(2,'license',7),interval '9 days');
insert into public.vendor_retention_hold_events(contractor_id,action,reason,business_key,actor)
 values(pg_temp.provider(2),'placed','Synthetic provider hold','fixture-renewal-upload-hold','b9100000-0000-4000-8000-000000000001');
select pg_temp.stored(pg_temp.path(3,'license',8),interval '9 days');
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,'license','license-v1',pg_temp.path(3,'license',8),now()-interval '1 day',now()+interval '1 year','b9100000-0000-4000-8000-000000000001'
 from public.vendor_onboarding o where o.contractor_id=pg_temp.provider(3);
select pg_temp.stored(pg_temp.path(4,'license',11),interval '30 days','vendor-documents-quarantine');
select pg_temp.stored(pg_temp.path(4,'insurance',12),interval '30 days','vendor-documents-quarantine');
insert into public.vendor_renewal_upload_retention_actions(contractor_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor,created_at) values
 (pg_temp.provider(4),pg_temp.path(4,'license',11),'quarantined',2048,'Synthetic fixture',false,'fixture-renewal-upload-q-11','b9100000-0000-4000-8000-000000000001',now()-interval '15 days'),
 (pg_temp.provider(4),pg_temp.path(4,'insurance',12),'quarantined',2048,'Synthetic fixture',false,'fixture-renewal-upload-q-12','b9100000-0000-4000-8000-000000000001',now()-interval '13 days');

-- Structure.
select ok(not has_table_privilege('authenticated','public.vendor_renewal_upload_retention_actions','SELECT'),
 'A signed-in caller cannot read the upload ledger');
select ok(not has_table_privilege('service_role','public.vendor_renewal_upload_retention_actions','INSERT'),
 'The service key cannot write the upload ledger');
select ok(not has_function_privilege('authenticated','private.vendor_renewal_unattached_uploads(uuid)','EXECUTE'),
 'A signed-in caller cannot list unsubmitted uploads directly');
select ok(not has_function_privilege('anon','public.vendor_renewal_upload_retention_prepare(text,text,text,text)','EXECUTE'),
 'An anonymous caller cannot prepare a step');
select ok(not has_function_privilege('service_role','public.vendor_renewal_upload_retention_record(text,text,text,text)','EXECUTE'),
 'The service key cannot record a step');
select ok(has_function_privilege('authenticated','public.vendor_renewal_upload_retention_record(text,text,text,text)','EXECUTE'),
 'A signed-in caller reaches the record command, which checks the operator role');
select throws_ok($$update public.vendor_renewal_upload_retention_actions set reason='changed'$$,
 '55000',null,'Ledger rows are immutable');

-- Which files are unsubmitted.
select is((select string_agg(split_part(path,'/',3)||':'||substr(split_part(path,'/',4),35,2),',' order by path)
   from private.vendor_renewal_unattached_uploads(pg_temp.provider(1))),'insurance:02,insurance:05,insurance:06,license:01,license:03',
 'Only unsubmitted files in the renewal layout are listed');
select is((select uploaded_at from private.vendor_renewal_unattached_uploads(pg_temp.provider(1)) where path=pg_temp.path(1,'license',1)),
 now()-interval '7 days 2 hours 1 minute','The upload time is the object''s creation time');
select is((select count(*) from private.vendor_renewal_unattached_uploads(pg_temp.provider(4))),2::bigint,
 'Quarantined uploads stay listed');

-- Vendors.
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select public.vendor_document_retention_queue()$$,'42501',null,'A vendor cannot read the queue');
select throws_ok(format('select public.vendor_renewal_upload_retention_prepare(%L,%L,%L,%L)',pg_temp.path(1,'license',1),'quarantined','Synthetic','v-1'),
 '42501',null,'A vendor cannot prepare a step');
-- Submission refused from 7 days, allowed before.
select throws_ok(format('select public.vendor_submit_renewal_document(%L)',pg_temp.path(1,'insurance',6)),
 'P0001','This upload has expired; upload the document again','An upload exactly 7 days old cannot be submitted');
select throws_ok(format('select public.vendor_submit_renewal_document(%L)',pg_temp.path(1,'license',1)),
 'P0001','This upload has expired; upload the document again','A due upload cannot be submitted');
select is((public.vendor_submit_renewal_document(pg_temp.path(1,'insurance',5))->>'recorded')::boolean,true,
 'An upload 6 days old can still be submitted');
reset role;

select pg_temp.as_user('1');
set local role authenticated;
-- Queue.
select is(pg_temp.listed('unattached_due'),'1:license:01,1:license:03,2:license:07',
 'Due: past the clock, retained and not bound, held providers included');
select is(pg_temp.listed('unattached_kept'),'3:license:08','Kept: the unsubmitted upload bound to evidence');
select is(pg_temp.listed('unattached_quarantined'),'4:insurance:12,4:license:11','Quarantined uploads are listed separately');
select is((pg_temp.entry('unattached_due',pg_temp.path(1,'license',1))->>'retention_ends_at')::timestamptz,
 now()-interval '1 minute','Its retention ends 7 days and 2 hours after upload');
select is(pg_temp.entry('unattached_due',pg_temp.path(1,'license',1))->>'name','Synthetic renewal provider','The provider is named');
select is(pg_temp.entry('unattached_due',pg_temp.path(1,'license',1))->>'file_name','synthetic-license.pdf','The file name drops the object id');
select is((pg_temp.entry('unattached_due',pg_temp.path(2,'license',7))->>'held')::boolean,true,'A provider hold is shown');
select is((public.vendor_document_retention_queue()->>'unattached_days')::int,7,'The queue states the 7-day clock');
select is((public.vendor_document_retention_queue()->>'upload_grant_hours')::int,2,'The queue states the 2-hour grant');

-- Prepare refusals.
select throws_ok(format('select pg_temp.step(%L,%L,%L,%L)','vendor_renewal_upload_retention_prepare',pg_temp.path(1,'insurance',2),'quarantined','k-2'),
 'P0001','Renewal uploads never submitted are kept for 7 days after their upload link expires','One minute short of the clock is not due');
select throws_ok(format('select pg_temp.step(%L,%L,%L,%L)','vendor_renewal_upload_retention_prepare',pg_temp.path(1,'license',4),'quarantined','k-4'),
 'P0001','This upload was submitted; declined submissions follow the renewal document rules','A submitted upload is refused');
select throws_ok(format('select pg_temp.step(%L,%L,%L,%L)','vendor_renewal_upload_retention_prepare',pg_temp.path(1,'insurance',5),'quarantined','k-5'),
 'P0001','This upload was submitted; declined submissions follow the renewal document rules','An upload submitted in this run is refused');
select throws_ok(format('select pg_temp.step(%L,%L,%L,%L)','vendor_renewal_upload_retention_prepare',pg_temp.path(3,'license',8),'quarantined','k-8'),
 'P0001','Documents bound to compliance evidence are kept','An upload bound to evidence is kept');
select throws_ok(format('select pg_temp.step(%L,%L,%L,%L)','vendor_renewal_upload_retention_prepare',pg_temp.path(2,'license',7),'quarantined','k-7'),
 'P0001','This provider is on a retention hold','A provider hold refuses quarantine');
select throws_ok(format('select pg_temp.step(%L,%L,%L,%L)','vendor_renewal_upload_retention_prepare','renewals/'||pg_temp.provider(1)::text||'/license/notes.txt','quarantined','k-x'),
 'P0001','Renewal upload not found','A file outside the layout is refused');
select throws_ok(format('select pg_temp.step(%L,%L,%L,%L)','vendor_renewal_upload_retention_prepare',pg_temp.path(1,'license',99),'quarantined','k-99'),
 'P0001','Renewal upload not found','A path storage never held is refused');
select throws_ok(format('select pg_temp.step(%L,%L,%L,%L)','vendor_renewal_upload_retention_prepare',pg_temp.path(4,'insurance',12),'deleted','k-12'),
 'P0001','Quarantined documents are kept for 14 days before deletion','An upload quarantined 13 days ago cannot be deleted');
select throws_ok(format('select pg_temp.step(%L,%L,%L,%L)','vendor_renewal_upload_retention_prepare',pg_temp.path(1,'license',1),'restored','k-1r'),
 'P0001','Renewal upload is not in quarantine','A retained upload cannot be restored');
select throws_ok(format('select pg_temp.step(%L,%L,%L,%L)','vendor_renewal_upload_retention_prepare',pg_temp.path(1,'license',1),'deleted','k-1d'),
 'P0001','Renewal upload must be quarantined before deletion','Deletion needs quarantine first');
select throws_ok(format('select public.vendor_renewal_upload_retention_prepare(%L,%L,%L,%L)',pg_temp.path(1,'license',1),'quarantined','','k-1e'),
 'P0001','A reason is required','A reason is required');
reset role;
select is(pg_temp.ledger(),2::bigint,'Refusals record nothing');

-- Quarantine a due upload.
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.step('vendor_renewal_upload_retention_prepare',pg_temp.path(1,'license',3),'quarantined','q-3')->>'to_bucket',
 'vendor-documents-quarantine','An upload exactly at the end of its clock can be quarantined');
select is(pg_temp.step('vendor_renewal_upload_retention_prepare',pg_temp.path(1,'license',1),'quarantined','q-1')->>'contractor_id',
 pg_temp.provider(1)::text,'Prepare names the provider from the path');
select throws_ok(format('select pg_temp.step(%L,%L,%L,%L)','vendor_renewal_upload_retention_record',pg_temp.path(1,'license',1),'quarantined','q-1'),
 'P0001','Storage does not show this document in quarantine','Recording before storage moved the file is refused');
reset role;
select pg_temp.move(pg_temp.path(1,'license',1),'vendor-documents-quarantine');
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.step('vendor_renewal_upload_retention_record',pg_temp.path(1,'license',1),'quarantined','q-1')->>'recorded','true',
 'The quarantine is recorded once storage shows it');
select is(pg_temp.step('vendor_renewal_upload_retention_record',pg_temp.path(1,'license',1),'quarantined','q-1')->>'recorded','false',
 'The same key replays');
select is(pg_temp.step('vendor_renewal_upload_retention_prepare',pg_temp.path(1,'license',1),'quarantined','q-1')->>'replay','true',
 'Prepare reports the replay so the route skips storage');
select throws_ok(format('select pg_temp.step(%L,%L,%L,%L)','vendor_renewal_upload_retention_record',pg_temp.path(1,'license',3),'quarantined','q-1'),
 'P0001','Retention idempotency conflict','A key reused for another upload is refused');
select is(pg_temp.listed('unattached_due'),'1:license:03,2:license:07','The quarantined upload leaves the due list');
select is(pg_temp.entry('unattached_quarantined',pg_temp.path(1,'license',1))->>'object_location','quarantine',
 'It appears in quarantine');
select throws_ok(format('select public.vendor_renewal_upload_retention_prepare(%L,%L,%L,%L)',pg_temp.path(1,'license',1),'quarantined','Synthetic','q-1b'),
 'P0001','Renewal upload already quarantined','A second quarantine is refused');
reset role;
select is((select size_bytes from public.vendor_renewal_upload_retention_actions where business_key='q-1'),2048::bigint,
 'The quarantine records the size storage showed');

-- A quarantined upload cannot be submitted or become evidence.
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok(format('select public.vendor_submit_renewal_document(%L)',pg_temp.path(1,'license',1)),
 'P0001','Uploaded document not found','A quarantined upload cannot be submitted');
reset role;
select throws_ok(format('insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by) select contractor_id,application_version_id,%L,%L,%L,now()-interval ''1 day'',now()+interval ''1 year'',%L from public.vendor_onboarding where contractor_id=%L',
  'license','license-v1',pg_temp.path(1,'license',1),'b9100000-0000-4000-8000-000000000001',pg_temp.provider(1)),
 'P0001','A document in retention quarantine cannot become evidence','A quarantined upload cannot become evidence');

-- Restore and delete.
select pg_temp.move(pg_temp.path(4,'insurance',12),'vendor-documents');
select pg_temp.remove(pg_temp.path(4,'license',11));
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.step('vendor_renewal_upload_retention_record',pg_temp.path(4,'insurance',12),'restored','r-12')->>'recorded','true',
 'A quarantined upload can be restored');
select is(pg_temp.step('vendor_renewal_upload_retention_prepare',pg_temp.path(4,'license',11),'deleted','d-11')->>'replay','false',
 'An upload 15 days in quarantine may be deleted');
select is(pg_temp.step('vendor_renewal_upload_retention_record',pg_temp.path(4,'license',11),'deleted','d-11')->>'recorded','true',
 'The deletion is recorded once storage shows the file gone');
select throws_ok(format('select public.vendor_renewal_upload_retention_prepare(%L,%L,%L,%L)',pg_temp.path(4,'license',11),'restored','Synthetic','d-11b'),
 'P0001','Renewal upload already deleted','A deleted upload stays deleted');
select is(pg_temp.listed('unattached_due'),'1:license:03,2:license:07,4:insurance:12',
 'A restored upload past its clock is due again');
reset role;
select is((select string_agg(state,',' order by path) from private.vendor_renewal_unattached_uploads(pg_temp.provider(4)) u
   cross join lateral private.vendor_renewal_upload_retention_state(u.path)),'retained,deleted',
 'The ledger still knows a deleted upload');

-- A hold placed after the move is recorded as under hold.
insert into public.vendor_retention_hold_events(contractor_id,action,reason,business_key,actor)
 values(pg_temp.provider(1),'placed','Synthetic late hold','fixture-renewal-upload-late-hold','b9100000-0000-4000-8000-000000000001');
select pg_temp.move(pg_temp.path(1,'license',3),'vendor-documents-quarantine');
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.step('vendor_renewal_upload_retention_prepare',pg_temp.path(1,'license',3),'quarantined','h-3')->>'replay','false',
 'A hold does not refuse a quarantine storage already shows');
select is(pg_temp.step('vendor_renewal_upload_retention_record',pg_temp.path(1,'license',3),'quarantined','h-3')->>'under_hold','true',
 'It is recorded under hold');
reset role;

-- The declined-document queue is unchanged, and nothing else changed.
select pg_temp.as_user('1');
set local role authenticated;
select is((select count(*) from jsonb_array_elements(public.vendor_document_retention_queue()->'due') e
   where e->>'contractor_id' like 'b9200000-%'),0::bigint,'No declined renewal document is added to the due list');
reset role;
select is((select count(*) from public.vendor_renewal_documents where contractor_id::text like 'b9200000-%'),2::bigint,
 'Only the fixture and the in-window submission exist');
select is((select count(*) from public.vendor_renewal_document_decisions x join public.vendor_renewal_documents d on d.id=x.document_id
   where d.contractor_id::text like 'b9200000-%'),0::bigint,'No decision was recorded');
select is((select count(*) from public.vendor_compliance_evidence where evidence_ref like 'renewals/b9200000-%'),1::bigint,'No evidence changed');
select is((select string_agg(status,',' order by contractor_id) from public.vendor_onboarding where contractor_id::text like 'b9200000-%'),
 'active,active,active,active','No onboarding status changed');

select * from finish();
rollback;
