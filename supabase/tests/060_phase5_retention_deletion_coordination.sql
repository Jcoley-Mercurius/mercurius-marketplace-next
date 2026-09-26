begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-093 synthetic fixtures only. Covers the deletion protocol that stops a retention hold
-- and a permanent deletion from both taking effect: prepare records a deletion request; the
-- quarantine policies let only the requesting operator see and delete the object, re-check
-- the step and refuse while a hold is in force; a policy-allowed deletion is recorded with
-- under_hold false even after a later hold. The Storage API's delete is reproduced exactly:
-- DELETE ... RETURNING on storage.objects as the caller's role with Storage's delete flag set.
-- The concurrent orderings through the real Storage API are in
-- scripts/phase5-retention-hold-coordination.mjs. No real provider, file or account is used.
insert into auth.users(id,email,email_confirmed_at) values
 ('b9500000-0000-4000-8000-000000000001','deletion-operator@example.invalid',now()),
 ('b9500000-0000-4000-8000-000000000002','deletion-operator-two@example.invalid',now()),
 ('b9500000-0000-4000-8000-000000000003','deletion-vendor@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b9500000-0000-4000-8000-000000000001','admin'),
 ('b9500000-0000-4000-8000-000000000002','admin'),
 ('b9500000-0000-4000-8000-000000000003','vendor');

create function pg_temp.provider(p_n integer) returns uuid language sql as $$
 select ('b9600000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
create function pg_temp.app(p_n integer) returns uuid language sql as $$
 select ('b9700000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
create function pg_temp.doc(p_n integer) returns uuid language sql as $$
 select ('b9800000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
create function pg_temp.renewal_path(p_provider integer,p_n integer) returns text language sql as $$
 select 'renewals/'||pg_temp.provider(p_provider)::text||'/license/c9500000-0000-4000-8000-'||lpad(p_n::text,12,'0')||'-synthetic-license.pdf' $$;
create function pg_temp.app_path(p_app integer) returns text language sql as $$
 select pg_temp.app(p_app)::text||'/license/c9600000-0000-4000-8000-'||lpad(p_app::text,12,'0')||'-synthetic-license.pdf' $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9500000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
-- The Storage API's delete: its flag, then DELETE ... RETURNING as the caller's role.
create function pg_temp.storage_delete(p_path text) returns bigint language plpgsql as $$
declare n bigint;
begin
 perform set_config('storage.allow_delete_query','true',true);
 with d as (delete from storage.objects where bucket_id='vendor-documents-quarantine' and name=p_path returning 1) select count(*) into n from d;
 perform set_config('storage.allow_delete_query','false',true);
 return n;
end $$;
-- A deletion outside the workflow (the service key), which bypasses row-level security.
create function pg_temp.service_remove(p_path text) returns void language plpgsql as $$
begin
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where name=p_path;
 perform set_config('storage.allow_delete_query','false',true);
end $$;
create function pg_temp.visible(p_path text) returns bigint language sql as $$
 select count(*) from storage.objects where bucket_id='vendor-documents-quarantine' and name=p_path $$;
create function pg_temp.stored(p_path text) returns boolean language sql security definer as $$
 select exists(select 1 from storage.objects where name=p_path) $$;
create function pg_temp.requests() returns bigint language sql security definer as $$
 select count(*) from public.vendor_retention_deletion_requests where storage_path like '%b96%' or storage_path like 'b97%' $$;
create function pg_temp.deletions(p_path text) returns bigint language sql security definer as $$
 select count(*) from public.vendor_retention_storage_deletions where storage_path=p_path $$;
grant execute on all functions in schema pg_temp to authenticated;

-- Providers 1-4, each active on a synthetic application version. Provider 4 is attached to
-- application 3.
insert into public.contractors(id,name,is_active,marketing_enabled) select pg_temp.provider(n),'Synthetic deletion provider '||n,true,false
 from generate_series(1,4) n;
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls,contractor_id)
 select pg_temp.app(10+n),'Synthetic deletion provider '||n,'Test','Provider','deletion-provider-'||n||'@example.invalid','synthetic','approved','{}',pg_temp.provider(n)
 from generate_series(1,4) n;
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select pg_temp.provider(n),v.id,2,'active' from generate_series(1,4) n
 join public.vendor_application_versions v on v.application_id=pg_temp.app(10+n);

-- Declined renewal documents 1 (provider 1) and 2 (provider 2): declined 130 days ago and in
-- quarantine for 20 days.
insert into storage.objects(bucket_id,name,metadata)
 select 'vendor-documents-quarantine',pg_temp.renewal_path(n,n),'{"size":2048,"mimetype":"application/pdf"}' from generate_series(1,2) n;
insert into public.vendor_renewal_documents(id,contractor_id,kind,storage_path,file_name,mime_type,size_bytes,submitted_by,submitted_as,created_at)
 select pg_temp.doc(n),pg_temp.provider(n),'license',pg_temp.renewal_path(n,n),'synthetic-license.pdf','application/pdf',2048,
   'b9500000-0000-4000-8000-000000000001','operator',now()-interval '131 days' from generate_series(1,2) n;
insert into public.vendor_renewal_document_decisions(document_id,outcome,note,business_key,actor,created_at)
 select pg_temp.doc(n),'declined','Synthetic decline','deletion-decline-'||n,'b9500000-0000-4000-8000-000000000001',now()-interval '130 days'
 from generate_series(1,2) n;
insert into public.vendor_renewal_retention_actions(document_id,action,reason,under_hold,business_key,actor,created_at)
 select pg_temp.doc(n),'quarantined','Synthetic fixture',false,'deletion-fixture-q-doc-'||n,'b9500000-0000-4000-8000-000000000001',now()-interval '20 days'
 from generate_series(1,2) n;

-- Never-submitted renewal uploads 11 (provider 1) and 13 (provider 3): uploaded 40 days ago,
-- in quarantine for 20 days.
insert into storage.objects(bucket_id,name,metadata,created_at) values
 ('vendor-documents-quarantine',pg_temp.renewal_path(1,11),'{"size":2048,"mimetype":"application/pdf"}',now()-interval '40 days'),
 ('vendor-documents-quarantine',pg_temp.renewal_path(3,13),'{"size":2048,"mimetype":"application/pdf"}',now()-interval '40 days');
insert into public.vendor_renewal_upload_retention_actions(contractor_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor,created_at) values
 (pg_temp.provider(1),pg_temp.renewal_path(1,11),'quarantined',2048,'Synthetic fixture',false,'deletion-fixture-q-up-11','b9500000-0000-4000-8000-000000000001',now()-interval '20 days'),
 (pg_temp.provider(3),pg_temp.renewal_path(3,13),'quarantined',2048,'Synthetic fixture',false,'deletion-fixture-q-up-13','b9500000-0000-4000-8000-000000000001',now()-interval '20 days');

-- Applications 1 and 2 (no provider) and 3 (provider 4): rejected 120 days ago, their one
-- listed file in quarantine for 20 days.
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls,contractor_id)
 select pg_temp.app(n),'Synthetic deletion applicant '||n,'Test','Applicant','deletion-applicant-'||n||'@example.invalid','synthetic','pending',
   array[pg_temp.app_path(n)],case when n=3 then pg_temp.provider(4) end
 from generate_series(1,3) n;
insert into public.vendor_application_closures(application_id,outcome,before_status,reason,business_key,actor,created_at)
 select pg_temp.app(n),'rejected','pending','Synthetic closure','deletion-close-'||n,'b9500000-0000-4000-8000-000000000001',now()-interval '120 days'
 from generate_series(1,3) n;
update public.vendor_applications set status='rejected' where id in (pg_temp.app(1),pg_temp.app(2),pg_temp.app(3));
insert into storage.objects(bucket_id,name,metadata)
 select 'vendor-documents-quarantine',pg_temp.app_path(n),'{"size":2048,"mimetype":"application/pdf"}' from generate_series(1,3) n;
insert into public.vendor_application_retention_actions(application_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor,created_at)
 select pg_temp.app(n),pg_temp.app_path(n),'quarantined',2048,'Synthetic fixture',false,'deletion-fixture-q-app-'||n,'b9500000-0000-4000-8000-000000000001',now()-interval '20 days'
 from generate_series(1,3) n;

-- Structure and privileges.
select ok(not has_table_privilege('authenticated','public.vendor_retention_deletion_requests','SELECT')
 and not has_table_privilege('authenticated','public.vendor_retention_storage_deletions','INSERT')
 and not has_table_privilege('service_role','public.vendor_retention_storage_deletions','SELECT'),'No client reads or writes the request or deletion tables');
select ok(not has_function_privilege('anon','public.vendor_retention_storage_delete_allowed(text,text)','execute')
 and not has_function_privilege('anon','public.vendor_retention_deletion_requested(text,text)','execute')
 and not has_function_privilege('authenticated','private.vendor_retention_request_deletion(text,uuid,text,text,text,uuid)','execute'),
 'Only authenticated executes the two policy functions; the request writer is private');
select is((select provolatile::text from pg_proc where oid='public.vendor_retention_storage_delete_allowed(text,text)'::regprocedure),'v',
 'The delete policy function is volatile, so it reads holds committed while it waited');
select is((select string_agg(provolatile::text,'' order by proname) from pg_proc where proname in
 ('vendor_prepare_renewal_retention','vendor_application_retention_prepare','vendor_renewal_upload_retention_prepare')),'vvv',
 'The three prepares may now write their deletion request');

-- 1. Prepare of a deletion records one request; the same key replays; a changed reason conflicts.
select pg_temp.as_user('1');
set local role authenticated;
select lives_ok($$select public.vendor_prepare_renewal_retention('b9800000-0000-4000-8000-000000000001','deleted','Synthetic deletion','del-doc-1')$$,
 'An operator prepares the deletion of a declined document');
select lives_ok($$select public.vendor_prepare_renewal_retention('b9800000-0000-4000-8000-000000000001','deleted','Synthetic deletion','del-doc-1')$$,
 'The same prepare replays');
select is(pg_temp.requests(),1::bigint,'One deletion request is recorded');
select throws_ok($$select public.vendor_prepare_renewal_retention('b9800000-0000-4000-8000-000000000001','deleted','Another reason','del-doc-1')$$,
 'P0001','Retention idempotency conflict','A key reused with another reason conflicts');
select lives_ok($$select public.vendor_prepare_renewal_retention('b9800000-0000-4000-8000-000000000001','restored','Synthetic restore','restore-doc-1')$$,
 'A restore prepare still passes');
select is(pg_temp.requests(),1::bigint,'Restore and quarantine prepares record no deletion request');

-- 2. Visibility and direct calls.
select is(pg_temp.visible(pg_temp.renewal_path(1,1)),1::bigint,'The requesting operator sees the object it asked to delete');
select is(pg_temp.visible(pg_temp.renewal_path(2,2)),0::bigint,'It sees no other quarantined object');
select is(public.vendor_retention_storage_delete_allowed('vendor-documents-quarantine',pg_temp.renewal_path(1,1)),false,
 'Called outside a Storage delete, the policy function allows nothing');
select is(pg_temp.deletions(pg_temp.renewal_path(1,1)),0::bigint,'and records nothing');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select is(pg_temp.visible(pg_temp.renewal_path(1,1)),0::bigint,'Another operator cannot see it');
select is(pg_temp.storage_delete(pg_temp.renewal_path(1,1)),0::bigint,'or delete it');
reset role;
select pg_temp.as_user('3');
set local role authenticated;
select is(pg_temp.storage_delete(pg_temp.renewal_path(1,1)),0::bigint,'A vendor cannot delete it');
reset role;
select ok(pg_temp.stored(pg_temp.renewal_path(1,1)),'The object is still stored');

-- 3. No hold: the Storage delete removes the object and records the deletion in the same
-- transaction; record then writes under_hold false.
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.storage_delete(pg_temp.renewal_path(1,1)),1::bigint,'The requesting operator deletes the object through Storage');
select is(pg_temp.visible(pg_temp.renewal_path(1,1)),0::bigint,'The request is closed; nothing is visible');
reset role;
select ok(not pg_temp.stored(pg_temp.renewal_path(1,1)),'The object is gone');
select is(pg_temp.deletions(pg_temp.renewal_path(1,1)),1::bigint,'One storage deletion row names the request');
select pg_temp.as_user('1');
set local role authenticated;
select is(public.vendor_record_renewal_retention('b9800000-0000-4000-8000-000000000001','deleted','Synthetic deletion','del-doc-1')->>'under_hold','false',
 'The deletion is recorded, not under hold');
reset role;

-- 4. Hold first: a request made before the hold no longer deletes.
select pg_temp.as_user('1');
set local role authenticated;
select lives_ok($$select public.vendor_prepare_renewal_retention('b9800000-0000-4000-8000-000000000002','deleted','Synthetic deletion','del-doc-2')$$,
 'Provider 2 document deletion prepared before any hold');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select lives_ok($$select public.vendor_place_retention_hold('b9600000-0000-4000-8000-000000000002','Synthetic hold','hold-provider-2')$$,
 'Another operator places a provider hold');
reset role;
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.storage_delete(pg_temp.renewal_path(2,2)),0::bigint,'The earlier request deletes nothing once the hold is in force');
reset role;
select ok(pg_temp.stored(pg_temp.renewal_path(2,2)),'The held file is still stored');
select is(pg_temp.deletions(pg_temp.renewal_path(2,2)),0::bigint,'No storage deletion is recorded');
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select public.vendor_record_renewal_retention('b9800000-0000-4000-8000-000000000002','deleted','Synthetic deletion','del-doc-2')$$,
 'P0001','This provider is on a retention hold','Record refuses the step as held');
select throws_ok($$select public.vendor_prepare_renewal_retention('b9800000-0000-4000-8000-000000000002','deleted','Synthetic deletion','del-doc-2b')$$,
 'P0001','This provider is on a retention hold','A new prepare is refused as held');
reset role;

-- 5. A file removed outside the workflow while held is still recorded under hold.
select pg_temp.service_remove(pg_temp.renewal_path(2,2));
select pg_temp.as_user('1');
set local role authenticated;
select is(public.vendor_record_renewal_retention('b9800000-0000-4000-8000-000000000002','deleted','Synthetic deletion','del-doc-2')->>'under_hold','true',
 'A removal with no storage deletion row is recorded under hold, as before');
reset role;

-- 6. Deletion first, hold later, request interrupted before record: the retry records the
-- deletion under_hold false.
select pg_temp.as_user('1');
set local role authenticated;
select lives_ok($$select public.vendor_renewal_upload_retention_prepare('renewals/b9600000-0000-4000-8000-000000000001/license/c9500000-0000-4000-8000-000000000011-synthetic-license.pdf','deleted','Synthetic deletion','del-up-11')$$,
 'A never-submitted upload deletion is prepared');
select is(pg_temp.storage_delete(pg_temp.renewal_path(1,11)),1::bigint,'Storage deletes it; the request then stops before record');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select lives_ok($$select public.vendor_place_retention_hold('b9600000-0000-4000-8000-000000000001','Synthetic later hold','hold-provider-1')$$,
 'A hold on provider 1 is placed after the deletion');
reset role;
select pg_temp.as_user('1');
set local role authenticated;
select lives_ok($$select public.vendor_renewal_upload_retention_prepare('renewals/b9600000-0000-4000-8000-000000000001/license/c9500000-0000-4000-8000-000000000011-synthetic-license.pdf','deleted','Synthetic deletion','del-up-11')$$,
 'The retry prepares despite the hold, since storage shows the step complete');
select is(pg_temp.storage_delete(pg_temp.renewal_path(1,11)),0::bigint,'The retried Storage call removes nothing');
select is(public.vendor_renewal_upload_retention_record(pg_temp.renewal_path(1,11),'deleted','Synthetic deletion','del-up-11')->>'under_hold','false',
 'The completed deletion is recorded after the later hold, not under hold');
reset role;

-- 7. Provider 3 upload: hold between prepare and Storage.
select pg_temp.as_user('1');
set local role authenticated;
select lives_ok($$select public.vendor_renewal_upload_retention_prepare('renewals/b9600000-0000-4000-8000-000000000003/license/c9500000-0000-4000-8000-000000000013-synthetic-license.pdf','deleted','Synthetic deletion','del-up-13')$$,
 'Provider 3 upload deletion prepared');
select lives_ok($$select public.vendor_place_retention_hold('b9600000-0000-4000-8000-000000000003','Synthetic hold','hold-provider-3')$$,
 'A hold is placed');
select is(pg_temp.storage_delete(pg_temp.renewal_path(3,13)),0::bigint,'The upload is not deleted under the hold');
select lives_ok($$select public.vendor_release_retention_hold('b9600000-0000-4000-8000-000000000003','Synthetic release','release-provider-3')$$,
 'The hold is released');
select is(pg_temp.storage_delete(pg_temp.renewal_path(3,13)),1::bigint,'The open request then deletes it');
select is(public.vendor_renewal_upload_retention_record(pg_temp.renewal_path(3,13),'deleted','Synthetic deletion','del-up-13')->>'under_hold','false',
 'and it is recorded');
reset role;

-- 8. Applications: an application hold, a provider hold on an attached provider, and no hold.
select pg_temp.as_user('1');
set local role authenticated;
select lives_ok($$select public.vendor_application_retention_prepare('b9700000-0000-4000-8000-000000000001','b9700000-0000-4000-8000-000000000001/license/c9600000-0000-4000-8000-000000000001-synthetic-license.pdf','deleted','Synthetic deletion','del-app-1')$$,
 'Application 1 deletion prepared');
select lives_ok($$select public.vendor_application_retention_prepare('b9700000-0000-4000-8000-000000000002','b9700000-0000-4000-8000-000000000002/license/c9600000-0000-4000-8000-000000000002-synthetic-license.pdf','deleted','Synthetic deletion','del-app-2')$$,
 'Application 2 deletion prepared');
select lives_ok($$select public.vendor_application_retention_prepare('b9700000-0000-4000-8000-000000000003','b9700000-0000-4000-8000-000000000003/license/c9600000-0000-4000-8000-000000000003-synthetic-license.pdf','deleted','Synthetic deletion','del-app-3')$$,
 'Application 3 deletion prepared');
select lives_ok($$select public.vendor_place_application_retention_hold('b9700000-0000-4000-8000-000000000001','Synthetic hold','hold-app-1')$$,
 'Application 1 is held');
select lives_ok($$select public.vendor_place_retention_hold('b9600000-0000-4000-8000-000000000004','Synthetic hold','hold-provider-4')$$,
 'Application 3''s provider is held');
select is(pg_temp.storage_delete(pg_temp.app_path(1)),0::bigint,'An application hold stops the deletion');
select is(pg_temp.storage_delete(pg_temp.app_path(3)),0::bigint,'A hold on an attached provider stops the deletion');
select is(pg_temp.storage_delete(pg_temp.app_path(2)),1::bigint,'An application with no hold is deleted');
select throws_ok($$select public.vendor_application_retention_record('b9700000-0000-4000-8000-000000000001','b9700000-0000-4000-8000-000000000001/license/c9600000-0000-4000-8000-000000000001-synthetic-license.pdf','deleted','Synthetic deletion','del-app-1')$$,
 'P0001','This application is on a retention hold','Record refuses the held application file');
select is(public.vendor_application_retention_record(pg_temp.app(2),pg_temp.app_path(2),'deleted','Synthetic deletion','del-app-2')->>'under_hold','false',
 'The unheld application file deletion is recorded');
reset role;
select ok(pg_temp.stored(pg_temp.app_path(1)) and pg_temp.stored(pg_temp.app_path(3)),'Both held application files are still stored');

-- 9. The policy re-runs the step: a file restored after its request cannot be deleted even
-- if something puts it back in quarantine outside the workflow.
select pg_temp.as_user('1');
set local role authenticated;
select lives_ok($$select public.vendor_release_application_retention_hold('b9700000-0000-4000-8000-000000000001','Synthetic release','release-app-1')$$,
 'Application 1 hold released');
reset role;
update storage.objects set bucket_id='vendor-documents' where name=pg_temp.app_path(1);
select pg_temp.as_user('1');
set local role authenticated;
select is(public.vendor_application_retention_record(pg_temp.app(1),pg_temp.app_path(1),'restored','Synthetic restore','restore-app-1')->>'recorded','true',
 'Application 1 file restored');
reset role;
update storage.objects set bucket_id='vendor-documents-quarantine' where name=pg_temp.app_path(1);
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.storage_delete(pg_temp.app_path(1)),0::bigint,'The old request cannot delete a file the ledger shows retained');
reset role;
select ok(pg_temp.stored(pg_temp.app_path(1)),'The file is still stored');

-- 10. The evidence tables stay immutable.
select throws_ok($$update public.vendor_retention_deletion_requests set reason='changed'$$,'55000',null,'Deletion requests are immutable');
select throws_ok($$delete from public.vendor_retention_storage_deletions$$,'55000',null,'Storage deletion rows are immutable');

select * from finish();
rollback;
