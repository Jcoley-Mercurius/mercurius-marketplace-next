begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-105, DEC-2026-030 (20261015001000). Synthetic fixtures only: an operator uploads
-- license and insurance documents for an applicant under review whose application had
-- no documents, and records checklist items 4 and 5 from them. The provider itself still
-- cannot submit in review; rejected and unknown providers are still refused.
insert into auth.users(id,email,email_confirmed_at) values
 ('b7610000-0000-4000-8000-000000000001','review-upload-operator@example.invalid',now()),
 ('b7610000-0000-4000-8000-000000000002','review-upload-vendor@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b7610000-0000-4000-8000-000000000001','admin'),
 ('b7610000-0000-4000-8000-000000000002','vendor');
-- 1 under review (account bound), 2 rejected, 3 no onboarding.
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b7620000-0000-4000-8000-000000000001','Synthetic review upload',false,false,'b7610000-0000-4000-8000-000000000002'),
 ('b7620000-0000-4000-8000-000000000002','Synthetic review upload rejected',false,false,null),
 ('b7620000-0000-4000-8000-000000000003','Synthetic review upload no onboarding',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls)
 select ('b7630000-0000-4000-8000-00000000000'||n)::uuid,'Synthetic review upload '||n,'Test','Review',
   'review-upload-'||n||'@example.invalid','synthetic',('b7620000-0000-4000-8000-00000000000'||n)::uuid,'{}'::text[]
 from generate_series(1,2) n;
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select ('b7620000-0000-4000-8000-00000000000'||n)::uuid,
   (select id from public.vendor_application_versions where application_id=('b7630000-0000-4000-8000-00000000000'||n)::uuid),
   1,case n when 1 then 'review' else 'rejected' end
 from generate_series(1,2) n;

create function pg_temp.path(p_kind text,p_n integer) returns text language sql as $$
 select 'renewals/b7620000-0000-4000-8000-000000000001/'||p_kind||'/'||
   'c7600000-0000-4000-8000-'||lpad(p_n::text,12,'0')||'-'||p_kind||'.pdf' $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7610000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.item(p_kind text) returns jsonb language sql as $$
 select i from jsonb_array_elements(public.vendor_onboarding_checklist('b7620000-0000-4000-8000-000000000001')->'items') i
  where i->>'kind'=p_kind $$;
insert into storage.objects(bucket_id,name,metadata)
 select 'vendor-documents',pg_temp.path(k,n),'{"size":2048,"mimetype":"application/pdf"}'::jsonb
   from (values ('license',1),('insurance',2)) x(k,n);

-- The provider in review still cannot submit for itself.
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select public.vendor_authorize_renewal_upload('license')$$,
 'P0001','Renewal documents are accepted only for active or suspended providers','the provider cannot submit while in review');
reset role;

select pg_temp.as_user('1');
set local role authenticated;
select is((public.vendor_renewal_document_overview('b7620000-0000-4000-8000-000000000001')->>'operator_upload')::boolean,true,
 'the operator upload applies to a provider in review');
select is((public.vendor_renewal_document_overview('b7620000-0000-4000-8000-000000000002')->>'operator_upload')::boolean,false,
 'the operator upload does not apply to a rejected provider');
select is((public.vendor_renewal_document_overview('b7620000-0000-4000-8000-000000000003')->>'operator_upload')::boolean,false,
 'the operator upload does not apply without onboarding');
select throws_ok($$select public.vendor_authorize_renewal_upload('license','b7620000-0000-4000-8000-000000000002')$$,
 'P0001','Renewal documents are accepted only for active or suspended providers','an operator cannot upload for a rejected provider');
select throws_ok($$select public.vendor_authorize_renewal_upload('license','b7620000-0000-4000-8000-000000000003')$$,
 'P0001','Renewal documents are accepted only for active or suspended providers','an operator cannot upload without onboarding');
select is(public.vendor_authorize_renewal_upload('license','b7620000-0000-4000-8000-000000000001')->>'submitted_as','operator',
 'an operator may upload for a provider in review');

-- Upload both, then record items 4 and 5 from them.
select is(public.vendor_submit_renewal_document(pg_temp.path('license',1),'b7620000-0000-4000-8000-000000000001')->>'recorded','true',
 'the operator submits the license for the provider in review');
select is(public.vendor_submit_renewal_document(pg_temp.path('insurance',2),'b7620000-0000-4000-8000-000000000001')->>'recorded','true',
 'the operator submits the insurance for the provider in review');
select is((select string_agg(d->>'state'||':'||(d->>'submitted_as'),',' order by d->>'kind')
   from jsonb_array_elements(public.vendor_renewal_document_overview('b7620000-0000-4000-8000-000000000001')->'documents') d),
 'submitted:operator,submitted:operator','both uploads await review as operator uploads');
select is(pg_temp.item('license')->>'state','missing','an upload alone does not satisfy the license item');
select is(public.vendor_renewal_document_overview('b7620000-0000-4000-8000-000000000001')->>'onboarding_status','review',
 'uploading does not change the onboarding status');

select throws_ok(format('select public.vendor_record_checklist_evidence(%L,%L,%L,%L,%L,%L,%L,%L)',
  'b7620000-0000-4000-8000-000000000001','insurance','R0 onboarding v1',pg_temp.path('license',1),now()-interval '1 minute',
  now()+interval '1 year',null,'review-upload-wrong-item'),
 'P0001','Renewal document was submitted for a different item','a license upload cannot satisfy the insurance item');
select is(public.vendor_record_checklist_evidence('b7620000-0000-4000-8000-000000000001','license','R0 onboarding v1',
  pg_temp.path('license',1),now()-interval '1 minute',now()+interval '1 year',null,'review-upload-license')->>'recorded','true',
 'the operator records the license item from the upload');
select is(public.vendor_record_checklist_evidence('b7620000-0000-4000-8000-000000000001','insurance','R0 onboarding v1',
  pg_temp.path('insurance',2),now()-interval '1 minute',now()+interval '1 year',null,'review-upload-insurance')->>'recorded','true',
 'the operator records the insurance item from the upload');
select is(pg_temp.item('license')->>'state','current','the license item is current');
select is(pg_temp.item('insurance')->>'state','current','the insurance item is current');
select is((select string_agg(d->>'state',',' order by d->>'kind')
   from jsonb_array_elements(public.vendor_renewal_document_overview('b7620000-0000-4000-8000-000000000001')->'documents') d),
 'accepted,accepted','both uploads are accepted by the recorded items');
select is(public.vendor_renewal_document_overview('b7620000-0000-4000-8000-000000000001')->>'onboarding_status','review',
 'recording evidence does not activate the provider');
reset role;

select * from finish();
rollback;
