begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-073 synthetic fixtures only. Covers renewal document submission, decline,
-- acceptance through the checklist command, the readbacks and removal of the anonymous
-- upload policy. Storage objects are synthetic rows with metadata only; no file, real
-- provider, account or document is represented here.
insert into auth.users(id,email,email_confirmed_at) values
 ('b7100000-0000-4000-8000-000000000001','renewal-docs-operator@example.invalid',now()),
 ('b7100000-0000-4000-8000-000000000002','renewal-docs-vendor-a@example.invalid',now()),
 ('b7100000-0000-4000-8000-000000000003','renewal-docs-vendor-b@example.invalid',now()),
 ('b7100000-0000-4000-8000-000000000004','renewal-docs-vendor-review@example.invalid',now()),
 ('b7100000-0000-4000-8000-000000000005','renewal-docs-plain@example.invalid',now()),
 ('b7100000-0000-4000-8000-000000000006','renewal-docs-unlinked@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b7100000-0000-4000-8000-000000000001','admin'),
 ('b7100000-0000-4000-8000-000000000002','vendor'),
 ('b7100000-0000-4000-8000-000000000003','vendor'),
 ('b7100000-0000-4000-8000-000000000004','vendor'),
 ('b7100000-0000-4000-8000-000000000006','vendor');
-- 1 active, 2 suspended, 3 under review.
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b7200000-0000-4000-8000-000000000001','Synthetic renewal documents A',true,false,'b7100000-0000-4000-8000-000000000002'),
 ('b7200000-0000-4000-8000-000000000002','Synthetic renewal documents B',false,false,'b7100000-0000-4000-8000-000000000003'),
 ('b7200000-0000-4000-8000-000000000003','Synthetic renewal documents review',false,false,'b7100000-0000-4000-8000-000000000004');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls)
 select ('b7300000-0000-4000-8000-00000000000'||n)::uuid,'Synthetic renewal documents '||n,'Test','Renewal',
   'renewal-docs-'||n||'@example.invalid','synthetic',('b7200000-0000-4000-8000-00000000000'||n)::uuid,
   array['synthetic/b7'||n||'/license.pdf','synthetic/b7'||n||'/insurance.pdf']
 from generate_series(1,3) n;
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select ('b7200000-0000-4000-8000-00000000000'||n)::uuid,
   (select id from public.vendor_application_versions where application_id=('b7300000-0000-4000-8000-00000000000'||n)::uuid),
   3,case n when 1 then 'active' when 2 then 'suspended' else 'review' end
 from generate_series(1,3) n;
-- Nine current items; provider A's license expires in 10 days.
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,k,k||'-v1',
   case when k in ('license','insurance') then 'synthetic/b7'||right(o.contractor_id::text,1)||'/'||k||'.pdf' else 'Synthetic '||k end,
   now()-interval '300 days',
   case when k='license' and o.contractor_id='b7200000-0000-4000-8000-000000000001' then now()+interval '10 days'
     when k in ('license','insurance') then now()+interval '1 year' end,
   'b7100000-0000-4000-8000-000000000001'
 from public.vendor_onboarding o
 cross join unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k
 where o.contractor_id::text like 'b7200000-%';

create function pg_temp.path(p_contractor text,p_kind text,p_n integer,p_ext text default 'pdf') returns text language sql as $$
 select 'renewals/b7200000-0000-4000-8000-00000000000'||p_contractor||'/'||p_kind||'/'||
   'c7000000-0000-4000-8000-'||lpad(p_n::text,12,'0')||'-renewed-'||p_kind||'.'||p_ext $$;
create function pg_temp.object(p_path text,p_size bigint default 2048,p_mime text default 'application/pdf') returns void language sql as $$
 insert into storage.objects(bucket_id,name,metadata) values('vendor-documents',p_path,jsonb_build_object('size',p_size,'mimetype',p_mime)) $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7100000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.item(p_contractor uuid,p_kind text) returns jsonb language sql as $$
 select i from jsonb_array_elements(public.vendor_onboarding_checklist(p_contractor)->'items') i where i->>'kind'=p_kind $$;
create function pg_temp.state() returns text language sql as $$ select md5(concat_ws('|',
 (select count(*) from public.vendor_compliance_evidence),
 (select count(*) from public.vendor_checklist_evidence_requests),
 (select string_agg(contractor_id||':'||status||':'||revision,',' order by contractor_id) from public.vendor_onboarding),
 (select count(*) from public.vendor_onboarding_events),
 (select count(*) from public.vendor_application_versions),
 (select count(*) from public.vendor_role_decisions),
 (select count(*) from public.user_roles),
 (select string_agg(id||':'||coalesce(is_active::text,'null')||':'||marketing_enabled::text,',' order by id) from public.contractors))) $$;
create function pg_temp.docs() returns text language sql as $$ select md5(concat_ws('|',
 (select count(*) from public.vendor_renewal_documents),(select count(*) from public.vendor_renewal_document_decisions))) $$;
create temp table snap(k text primary key,v text);
grant all on snap to authenticated;
insert into snap values('before',pg_temp.state());

select pg_temp.object(pg_temp.path('1','license',1));
select pg_temp.object(pg_temp.path('1','insurance',2));
select pg_temp.object(pg_temp.path('2','insurance',3));
select pg_temp.object(pg_temp.path('1','license',4),2048,'text/html');
select pg_temp.object(pg_temp.path('1','license',5),10485761);
select pg_temp.object(pg_temp.path('1','license',6,'png'),4096,'image/png');

-- Storage: the anonymous application upload policy is gone.
select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
 and policyname='Applicants can upload application documents'),'The anonymous application upload policy is removed');
set local role anon;
select throws_ok($$insert into storage.objects(bucket_id,name) values('vendor-documents','applications/synthetic-anonymous.pdf')$$,
 '42501',null,'An anonymous caller cannot insert into the private vendor documents bucket');
reset role;
select pg_temp.as_user('5');
set local role authenticated;
select throws_ok($$insert into storage.objects(bucket_id,name) values('vendor-documents','renewals/b7200000-0000-4000-8000-000000000001/license/synthetic.pdf')$$,
 '42501',null,'A signed-in caller cannot insert renewal objects directly');
reset role;

-- Access.
set local role anon;
select throws_ok($$select public.vendor_authorize_renewal_upload('license')$$,
 '42501','permission denied for function vendor_authorize_renewal_upload','Anonymous caller cannot authorize an upload');
select throws_ok($$select public.vendor_own_renewal_documents()$$,
 '42501','permission denied for function vendor_own_renewal_documents','Anonymous caller cannot read renewal submissions');
reset role;
set local role service_role;
select throws_ok($$select public.vendor_submit_renewal_document('x')$$,
 '42501','permission denied for function vendor_submit_renewal_document','Service role cannot submit a renewal document');
select throws_ok($$select public.vendor_renewal_document_queue()$$,
 '42501','permission denied for function vendor_renewal_document_queue','Service role cannot read the renewal document queue');
reset role;
set local role authenticated;
select throws_ok($$select * from private.vendor_renewal_submitter(null)$$,
 '42501','permission denied for schema private','The submitter resolution is not a client function');
select throws_ok($$select count(*) from public.vendor_renewal_documents$$,
 '42501','permission denied for table vendor_renewal_documents','Clients cannot read the submissions table');
select throws_ok($$select count(*) from public.vendor_renewal_document_decisions$$,
 '42501','permission denied for table vendor_renewal_document_decisions','Clients cannot read the decisions table');
reset role;
select pg_temp.as_user('5');
set local role authenticated;
select throws_ok($$select public.vendor_authorize_renewal_upload('license')$$,
 '42501','Vendor account required','An account without the vendor role cannot submit');
reset role;
select pg_temp.as_user('6');
set local role authenticated;
select throws_ok($$select public.vendor_authorize_renewal_upload('license')$$,
 '42501','Linked provider required','A vendor account without a provider cannot submit');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select public.vendor_authorize_renewal_upload('license','b7200000-0000-4000-8000-000000000002')$$,
 '42501','Onboarding operator required','A vendor cannot submit for a named provider');
select throws_ok($$select public.vendor_authorize_renewal_upload('identity')$$,
 'P0001','Renewal documents are for license or insurance only','Only license and insurance take renewal documents');
select is(public.vendor_authorize_renewal_upload('license'),
 '{"kind":"license","contractor_id":"b7200000-0000-4000-8000-000000000001","submitted_as":"provider"}'::jsonb,
 'A vendor is authorized for its own active provider');
select throws_ok($$select public.vendor_renewal_document_queue()$$,
 '42501','Onboarding operator required','A vendor cannot read the operator queue');
select throws_ok($$select public.vendor_renewal_document_overview('b7200000-0000-4000-8000-000000000001')$$,
 '42501','Onboarding operator required','A vendor cannot read the operator overview');
reset role;
select pg_temp.as_user('3');
set local role authenticated;
select is(public.vendor_authorize_renewal_upload('insurance')->>'contractor_id','b7200000-0000-4000-8000-000000000002',
 'A suspended provider may submit');
reset role;
select pg_temp.as_user('4');
set local role authenticated;
select throws_ok($$select public.vendor_authorize_renewal_upload('license')$$,
 'P0001','Renewal documents are accepted only for active or suspended providers','A provider under review uses the application instead');
reset role;
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select public.vendor_authorize_renewal_upload('license','b7200000-0000-4000-8000-000000000003')$$,
 'P0001','Renewal documents are accepted only for active or suspended providers','An operator cannot submit for a provider under review');
select throws_ok($$select public.vendor_authorize_renewal_upload('license','b7200000-0000-4000-8000-000000000009')$$,
 'P0001','Renewal documents are accepted only for active or suspended providers','An operator cannot submit for an unknown provider');
select is(public.vendor_authorize_renewal_upload('license','b7200000-0000-4000-8000-000000000001')->>'submitted_as','operator',
 'An operator is authorized on the provider''s behalf');
reset role;

-- Submission.
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok(format('select public.vendor_submit_renewal_document(%L)',pg_temp.path('1','license',99)),
 'P0001','Uploaded document not found','A path with no uploaded object is refused');
select throws_ok(format('select public.vendor_submit_renewal_document(%L)',pg_temp.path('2','insurance',3)),
 'P0001','Document path does not belong to this provider','A vendor cannot submit another provider''s object');
select throws_ok($$select public.vendor_submit_renewal_document('synthetic/b71/license.pdf')$$,
 'P0001','Document path does not belong to this provider','An application document path is not a renewal submission');
select throws_ok(format('select public.vendor_submit_renewal_document(%L)',replace(pg_temp.path('1','license',1),'/license/','/identity/')),
 'P0001','Document path does not belong to this provider','A path for another item is refused');
select throws_ok(format('select public.vendor_submit_renewal_document(%L)',pg_temp.path('1','license',4)),
 'P0001','Uploaded document failed verification','An object stored with a disallowed type is refused');
select throws_ok(format('select public.vendor_submit_renewal_document(%L)',pg_temp.path('1','license',5)),
 'P0001','Uploaded document failed verification','An object larger than 10 MB is refused');
select is(public.vendor_submit_renewal_document(pg_temp.path('1','license',1))-'document_id',
 '{"kind":"license","recorded":true,"contractor_id":"b7200000-0000-4000-8000-000000000001","submitted_as":"provider"}'::jsonb,
 'A vendor submits a renewed license for its own provider');
select is(public.vendor_submit_renewal_document(pg_temp.path('1','license',1))->>'recorded','false','The same submitter replays the same path');
reset role;
select is((select string_agg(file_name||':'||mime_type||':'||size_bytes||':'||submitted_as,',') from public.vendor_renewal_documents
 where storage_path=pg_temp.path('1','license',1)),'renewed-license.pdf:application/pdf:2048:provider',
 'Name, type and size come from the stored object');
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_submit_renewal_document(%L,%L)',pg_temp.path('1','license',1),'b7200000-0000-4000-8000-000000000001'),
 'P0001','Renewal document already submitted','Another submitter cannot claim a submitted path');
select is(public.vendor_submit_renewal_document(pg_temp.path('1','insurance',2),'b7200000-0000-4000-8000-000000000001')->>'submitted_as',
 'operator','An operator submits on the provider''s behalf');
reset role;
select pg_temp.as_user('3');
set local role authenticated;
select is(public.vendor_submit_renewal_document(pg_temp.path('2','insurance',3))->>'recorded','true','A suspended provider submits renewed insurance');
reset role;
select is(pg_temp.state(),(select v from snap where k='before'),
 'Submissions created no evidence, decision, revision, application version, role or listing change');

-- Open limit: five undecided submissions per item.
select pg_temp.object(pg_temp.path('1','license',10+n)) from generate_series(1,4) n;
select pg_temp.as_user('2');
set local role authenticated;
select public.vendor_submit_renewal_document(pg_temp.path('1','license',10+n)) from generate_series(1,4) n;
select throws_ok($$select public.vendor_authorize_renewal_upload('license')$$,
 'P0001','Too many renewal documents are awaiting review','Upload authorization stops at five undecided submissions');
select throws_ok(format('select public.vendor_submit_renewal_document(%L)',pg_temp.path('1','license',6,'png')),
 'P0001','Too many renewal documents are awaiting review','Submission stops at five undecided submissions');
select is(public.vendor_authorize_renewal_upload('insurance')->>'kind','insurance','The limit is per item');

reset role;

-- Decline.
insert into snap select 'decline-doc',id::text from public.vendor_renewal_documents where storage_path=pg_temp.path('1','license',11);
insert into snap select 'accept-doc',id::text from public.vendor_renewal_documents where storage_path=pg_temp.path('1','license',1);
insert into snap select 'insurance-doc',id::text from public.vendor_renewal_documents where storage_path=pg_temp.path('1','insurance',2);
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok(format('select public.vendor_decline_renewal_document(%L,%L,%L)',(select v from snap where k='decline-doc'),'Synthetic','k'),
 '42501','Onboarding operator required','A vendor cannot decline a submission');
reset role;
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_decline_renewal_document(%L,%L,%L)',(select v from snap where k='decline-doc'),'Synthetic',' '),
 'P0001','Idempotency key required','A decline requires a key');
select throws_ok(format('select public.vendor_decline_renewal_document(%L,%L,%L)',(select v from snap where k='decline-doc'),'  ','decline-blank'),
 'P0001','A note for the provider is required','A decline requires a note for the provider');
select throws_ok(format('select public.vendor_decline_renewal_document(%L,%L,%L)','b7900000-0000-4000-8000-000000000001','Synthetic','decline-unknown'),
 'P0001','Renewal document not found','An unknown document cannot be declined');
select is(public.vendor_decline_renewal_document((select v from snap where k='decline-doc')::uuid,' Synthetic: the certificate is unreadable. ','decline-1')->>'recorded',
 'true','An operator declines a submission with a note');
select is(public.vendor_decline_renewal_document((select v from snap where k='decline-doc')::uuid,'Synthetic: the certificate is unreadable.','decline-1')->>'recorded',
 'false','The exact decline replays');
select throws_ok(format('select public.vendor_decline_renewal_document(%L,%L,%L)',(select v from snap where k='decline-doc'),'Synthetic: other note','decline-1'),
 'P0001','Renewal decision idempotency conflict','A changed note under the same key conflicts');
select throws_ok(format('select public.vendor_decline_renewal_document(%L,%L,%L)',(select v from snap where k='decline-doc'),'Synthetic again','decline-2'),
 'P0001','Renewal document already decided','A decided submission cannot be declined again');
reset role;
select is(pg_temp.state(),(select v from snap where k='before'),'A decline changed no evidence, status, revision, role or listing');
select pg_temp.as_user('2');
set local role authenticated;
select is(public.vendor_authorize_renewal_upload('license')->>'kind','license','A declined submission frees a place under the limit');
reset role;

-- Acceptance through the checklist command.
select pg_temp.as_user('1');
set local role authenticated;
insert into snap values('license-before',pg_temp.item('b7200000-0000-4000-8000-000000000001','license')->>'evidence_id');
select throws_ok(format('select public.vendor_record_checklist_evidence(%L,%L,%L,%L,%L,%L,%L,%L)',
 'b7200000-0000-4000-8000-000000000001','license','license-v2',pg_temp.path('1','license',11),now()-interval '1 minute',now()+interval '1 year',
 (select v from snap where k='license-before'),'accept-declined'),
 'P0001','Renewal document already decided','A declined submission cannot be accepted');
select throws_ok(format('select public.vendor_record_checklist_evidence(%L,%L,%L,%L,%L,%L,%L,%L)',
 'b7200000-0000-4000-8000-000000000001','license','license-v2',pg_temp.path('1','insurance',2),now()-interval '1 minute',now()+interval '1 year',
 (select v from snap where k='license-before'),'accept-wrong-item'),
 'P0001','Renewal document was submitted for a different item','An insurance submission cannot satisfy the license item');
select throws_ok(format('select public.vendor_record_checklist_evidence(%L,%L,%L,%L,%L,%L,%L,%L)',
 'b7200000-0000-4000-8000-000000000001','insurance','insurance-v2',pg_temp.path('2','insurance',3),now()-interval '1 minute',now()+interval '1 year',
 pg_temp.item('b7200000-0000-4000-8000-000000000001','insurance')->>'evidence_id','accept-other-provider'),
 'P0001','Document must belong to the current provider application','Another provider''s submission cannot be accepted');
select throws_ok(format('select public.vendor_record_checklist_evidence(%L,%L,%L,%L,%L,%L,%L,%L)',
 'b7200000-0000-4000-8000-000000000001','license','license-v2',pg_temp.path('1','license',1),now()-interval '1 minute',null,
 (select v from snap where k='license-before'),'accept-no-expiry'),
 'P0001','License and insurance evidence requires an expiry','An accepted submission still requires an operator-entered expiry');
select is(public.vendor_record_checklist_evidence('b7200000-0000-4000-8000-000000000001','license','license-v2',pg_temp.path('1','license',1),
 now()-interval '1 minute',now()+interval '1 year',(select v from snap where k='license-before')::uuid,'accept-1')->>'recorded',
 'true','An operator accepts a renewal submission as license evidence');
select is(pg_temp.item('b7200000-0000-4000-8000-000000000001','license')->>'evidence_ref',pg_temp.path('1','license',1),
 'The license evidence references the renewal submission');
select is(pg_temp.item('b7200000-0000-4000-8000-000000000001','license')->>'state','current','The renewed license is current');
select is((pg_temp.item('b7200000-0000-4000-8000-000000000001','license')->>'renewal_due')::boolean,false,'The renewed license is no longer due');
select is(public.vendor_record_checklist_evidence('b7200000-0000-4000-8000-000000000001','license','license-v2',pg_temp.path('1','license',1),
 now()-interval '1 minute',now()+interval '1 year',(select v from snap where k='license-before')::uuid,'accept-1')->>'recorded',
 'false','The exact acceptance replays');
select throws_ok(format('select public.vendor_record_checklist_evidence(%L,%L,%L,%L,%L,%L,%L,%L)',
 'b7200000-0000-4000-8000-000000000001','license','license-v3',pg_temp.path('1','license',1),now()-interval '1 minute',now()+interval '2 years',
 pg_temp.item('b7200000-0000-4000-8000-000000000001','license')->>'evidence_id','accept-again'),
 'P0001','Renewal document already decided','An accepted submission cannot be accepted again');
select is(public.vendor_record_checklist_evidence('b7200000-0000-4000-8000-000000000001','license','license-v3','synthetic/b71/license.pdf',
 now()-interval '1 minute',now()+interval '1 year',(pg_temp.item('b7200000-0000-4000-8000-000000000001','license')->>'evidence_id')::uuid,'accept-application-document')->>'recorded',
 'true','Application documents are still accepted');
reset role;
select is((select outcome||':'||(evidence_id is not null)::text||':'||business_key from public.vendor_renewal_document_decisions
 where document_id=(select v from snap where k='accept-doc')::uuid),'accepted:true:accept-1',
 'Acceptance records one decision naming the evidence under the request key');
select is((select evidence_id from public.vendor_renewal_document_decisions where document_id=(select v from snap where k='accept-doc')::uuid),
 (select evidence_id from public.vendor_checklist_evidence_requests where business_key='accept-1'),'The decision names the recorded evidence');
select is((select string_agg(contractor_id||':'||status||':'||revision,',' order by contractor_id) from public.vendor_onboarding where contractor_id::text like 'b7200000-%'),
 'b7200000-0000-4000-8000-000000000001:active:3,b7200000-0000-4000-8000-000000000002:suspended:3,b7200000-0000-4000-8000-000000000003:review:3',
 'Acceptance changed no onboarding status or revision');
select is((select count(*) from public.vendor_application_versions where application_id::text like 'b7300000-%'),3::bigint,
 'Acceptance created no application version, so no re-review follows');
select is(public.vendor_is_eligible('b7200000-0000-4000-8000-000000000001'),true,'The provider stays eligible');

-- A failed acceptance writes nothing: the decision and the evidence share one transaction.
insert into snap values('before-failed',pg_temp.state()||pg_temp.docs());
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok(format('select public.vendor_record_checklist_evidence(%L,%L,%L,%L,%L,%L,%L,%L)',
 'b7200000-0000-4000-8000-000000000001','insurance','insurance-v2',pg_temp.path('1','insurance',2),now()-interval '1 minute',now()+interval '1 year',
 null,'accept-stale'),
 'P0001','Stale evidence version','A stale acceptance is refused by the kernel');
reset role;
select is(pg_temp.state()||pg_temp.docs(),(select v from snap where k='before-failed'),'A refused acceptance recorded no decision or evidence');
insert into snap values('before-readbacks',pg_temp.state()||pg_temp.docs());
select pg_temp.as_user('1');
set local role authenticated;
select is((select d->>'state' from jsonb_array_elements(public.vendor_renewal_document_overview('b7200000-0000-4000-8000-000000000001')->'documents') d
 where d->>'storage_path'=pg_temp.path('1','insurance',2)),'submitted','The submission stays undecided after a refused acceptance');

-- Operator readbacks.
select is(jsonb_array_length(public.vendor_renewal_document_overview('b7200000-0000-4000-8000-000000000001')->'documents'),6,
 'The overview lists every submission for the provider');
select is((select string_agg(d->>'state',',' order by d->>'state') from jsonb_array_elements(public.vendor_renewal_document_overview('b7200000-0000-4000-8000-000000000001')->'documents') d),
 'accepted,declined,submitted,submitted,submitted,submitted','The overview reports each submission''s state');
select ok((select bool_and(d ? 'storage_path' and d ? 'evidence_id') from jsonb_array_elements(public.vendor_renewal_document_overview('b7200000-0000-4000-8000-000000000001')->'documents') d),
 'The operator overview carries the storage path for review');
select is((select d->>'note' from jsonb_array_elements(public.vendor_renewal_document_overview('b7200000-0000-4000-8000-000000000001')->'documents') d where d->>'state'='declined'),
 'Synthetic: the certificate is unreadable.','The overview carries the trimmed decline note');
select is((select string_agg((e->>'name')||':'||(e->>'kind'),',' order by (e->>'name')||':'||(e->>'kind')) from jsonb_array_elements(public.vendor_renewal_document_queue()->'entries') e
 where e->>'contractor_id' like 'b7200000-%'),
 'Synthetic renewal documents A:insurance,Synthetic renewal documents A:license,Synthetic renewal documents A:license,Synthetic renewal documents A:license,Synthetic renewal documents B:insurance',
 'The queue lists only undecided submissions');
reset role;

-- Vendor readbacks.
select pg_temp.as_user('3');
set local role authenticated;
select is(jsonb_array_length(public.vendor_own_renewal_documents()->'documents'),1,'A vendor sees only its own submissions');
select ok((public.vendor_own_renewal_documents()->>'accepting')::boolean,'A suspended provider is told submissions are accepted');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select is((select array_agg(k order by k) from jsonb_object_keys(public.vendor_own_renewal_documents()->'documents'->0) k),
 array['created_at','decided_at','file_name','id','kind','note','state','submitted_as'],
 'A vendor submission carries no storage path, evidence or reviewer');
select is((select d->>'note' from jsonb_array_elements(public.vendor_own_renewal_documents()->'documents') d where d->>'state'='declined'),
 'Synthetic: the certificate is unreadable.','The provider sees the decline note');
select is((public.vendor_own_renewal_documents()->>'open_limit')::integer,5,'The vendor is told the open limit');
reset role;
select pg_temp.as_user('4');
set local role authenticated;
select is(public.vendor_own_renewal_documents()-'open_limit','{"accepting":false,"documents":[]}'::jsonb,'A provider under review is not accepting renewal submissions');
reset role;
select pg_temp.as_user('6');
set local role authenticated;
select is(public.vendor_own_renewal_documents()-'open_limit','{"accepting":false,"documents":[]}'::jsonb,'A vendor account without a provider has none');
reset role;
select is(pg_temp.state()||pg_temp.docs(),(select v from snap where k='before-readbacks'),'Every readback wrote nothing');

-- Immutability and table constraints.
select throws_ok(format('update public.vendor_renewal_documents set file_name=%L where id=%L','changed.pdf',(select v from snap where k='accept-doc')),
 null,null,'Submissions are immutable');
select throws_ok(format('delete from public.vendor_renewal_document_decisions where document_id=%L',(select v from snap where k='decline-doc')),
 null,null,'Decisions are immutable');
select throws_ok(format('insert into public.vendor_renewal_documents(contractor_id,kind,storage_path,file_name,mime_type,size_bytes,submitted_by,submitted_as) values(%L,%L,%L,%L,%L,%s,%L,%L)',
 'b7200000-0000-4000-8000-000000000002','license',pg_temp.path('1','license',77),'x.pdf','application/pdf',10,'b7100000-0000-4000-8000-000000000001','operator'),
 '23514',null,'A stored path must match the provider and item');
select throws_ok(format('insert into public.vendor_renewal_document_decisions(document_id,outcome,business_key,actor) values(%L,%L,%L,%L)',
 (select v from snap where k='insurance-doc'),'declined','no-note','b7100000-0000-4000-8000-000000000001'),
 '23514',null,'A stored decline must carry a note');

select * from finish();
rollback;
