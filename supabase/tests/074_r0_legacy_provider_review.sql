-- TRACE-105 / DEC-2026-027: onboarding review for a listed legacy provider without an
-- application. The operator record opens review on the existing provider (never a new
-- one), raises no new-application notification, and the unchanged checklist, activation
-- and listing rules follow. Synthetic identities only. Every change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator; 2 owner of L (bound through access); 3 unrelated signed-in user.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('e7400000-0000-4000-8000-000000000001','operator@example.test',now(),'{}'),
 ('e7400000-0000-4000-8000-000000000002','owner-l@example.test',now(),'{}'),
 ('e7400000-0000-4000-8000-000000000003','someone@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values ('e7400000-0000-4000-8000-000000000001','admin');

-- L, M, E, A are on the legacy list; X is not. M has a live access attempt; E is excluded;
-- A already has an open application linked to it.
insert into public.contractors(id,name,bio,services,is_active,marketing_enabled,email,phone,website,years_experience,user_id)
 select x.id::uuid,x.name,'Real description',array[(select id from public.services_catalog where is_active order by id limit 1)],
        true,true,null,'555-0100','https://example.test',12,null
   from (values ('e7410000-0000-4000-8000-00000000000a','Synthetic Legacy L'),
                ('e7410000-0000-4000-8000-00000000000b','Synthetic Legacy M'),
                ('e7410000-0000-4000-8000-00000000000c','Synthetic Legacy E'),
                ('e7410000-0000-4000-8000-00000000000d','Synthetic Legacy A'),
                ('e7410000-0000-4000-8000-00000000000e','Synthetic Unlisted X')) x(id,name);

create function pg_temp.run(p_sub uuid, p_role text, p_sql text)
returns jsonb language plpgsql as $$
declare result jsonb;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('role',p_role,'sub',p_sub)::text,true);
 execute format('set local role %I', p_role);
 execute p_sql into result;
 reset role;
 return result;
end $$;
create function pg_temp.op(p_sql text) returns jsonb language sql as $$
 select pg_temp.run('e7400000-0000-4000-8000-000000000001','authenticated',p_sql) $$;
create function pg_temp.user(p_n int, p_sql text) returns jsonb language sql as $$
 select pg_temp.run(('e7400000-0000-4000-8000-00000000000'||p_n)::uuid,'authenticated',p_sql) $$;
create function pg_temp.start(p_contractor uuid, p_key text, p_reason text default 'Legacy provider, documents on file (synthetic)')
returns jsonb language sql as $$
 select pg_temp.op(format('select public.r0_start_legacy_provider_review(%L,%L,%L)',p_contractor,p_reason,p_key)) $$;
create temp table t(k text primary key, v jsonb);
grant all on t to authenticated;

-- Setup access: contacts for L, M, E, A, X; L bound; M left with a live attempt.
select pg_temp.op(format('select public.r0_record_provider_contact(%L,%L,''Owner confirmed (synthetic)'',''R0 access'',%L)',
  x.id,x.email,'c-'||x.email))
 from (values ('e7410000-0000-4000-8000-00000000000a','owner-l@example.test'),
              ('e7410000-0000-4000-8000-00000000000b','owner-m@example.test'),
              ('e7410000-0000-4000-8000-00000000000c','owner-e@example.test'),
              ('e7410000-0000-4000-8000-00000000000d','owner-a@example.test'),
              ('e7410000-0000-4000-8000-00000000000e','owner-x@example.test')) x(id,email);
insert into t values ('pl', pg_temp.op(format('select public.r0_prepare_provider_access(%L,''p-l-1'',%L,%L)',
  'e7410000-0000-4000-8000-00000000000a',now()+interval '7 days','e7400000-0000-4000-8000-000000000002')));
select pg_temp.user(2,format('select public.r0_accept_provider_access(%L)',(select v->>'attempt_id' from t where k='pl')));
select is(pg_temp.op(format('select public.r0_bind_provider_access(%L,%L,''Bound (synthetic)'',''b-l'')',
  'e7410000-0000-4000-8000-00000000000a',(select v->>'attempt_id' from t where k='pl')))->>'recorded','true','setup: L is bound through access');
select pg_temp.op(format('select public.r0_prepare_provider_access(%L,''p-m-1'',%L)',
  'e7410000-0000-4000-8000-00000000000b',now()+interval '7 days'));
insert into private.r0_public_listing_exclusions(contractor_id,reason,excluded_by)
 values ('e7410000-0000-4000-8000-00000000000c','Excluded (synthetic)','e7400000-0000-4000-8000-000000000001');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,years_experience,services,status,contractor_id)
 values ('e7420000-0000-4000-8000-00000000000d','Synthetic Legacy A','Ari','Owner','owner-a@example.test','synthetic',5,'{}','pending',
         'e7410000-0000-4000-8000-00000000000d');
-- The migration records the real list by name; synthetic providers are listed directly.
insert into private.r0_legacy_review_providers(contractor_id)
 select unnest(array['e7410000-0000-4000-8000-00000000000a','e7410000-0000-4000-8000-00000000000b',
   'e7410000-0000-4000-8000-00000000000c','e7410000-0000-4000-8000-00000000000d']::uuid[]);
create temp table notices as select count(*)::int as n from public.notifications;
grant all on notices to authenticated;

-- Least privilege ------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated','public.r0_start_legacy_provider_review(uuid,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.r0_start_legacy_provider_review(uuid,text,text)','EXECUTE')
  and not has_function_privilege('service_role','public.r0_start_legacy_provider_review(uuid,text,text)','EXECUTE'),
 'the start is signed-in only');
select ok(has_function_privilege('authenticated','public.r0_legacy_review_status(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.r0_legacy_review_status(uuid)','EXECUTE'),'the status read is signed-in only');
select ok(not has_function_privilege(r,'private.r0_legacy_intake_active()','EXECUTE'),'no client reads the intake flag: '||r)
 from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_table_privilege(r,'private.r0_legacy_review_providers','INSERT')
  and not has_table_privilege(r,'private.r0_legacy_review_providers','SELECT'),'no client reads or extends the list: '||r)
 from unnest(array['anon','authenticated','service_role']) r;
select throws_ok(format('select pg_temp.user(3,%L)',format('select public.r0_start_legacy_provider_review(%L,''r'',''k'')',
  'e7410000-0000-4000-8000-00000000000a')),'42501','Onboarding operator required','a non-operator cannot start review');
select throws_ok(format('select pg_temp.user(2,%L)',format('select public.r0_legacy_review_status(%L)',
  'e7410000-0000-4000-8000-00000000000a')),'42501','Onboarding operator required','the provider cannot read the status');

-- Status and refusals ----------------------------------------------------------------------------
insert into t values ('st1', pg_temp.op($$select public.r0_legacy_review_status('e7410000-0000-4000-8000-00000000000a')$$));
select is((select (v->>'listed')::boolean and not (v->>'started')::boolean and not (v->>'onboarding')::boolean
  and (v->>'contact')::boolean and not (v->>'live_attempt')::boolean from t where k='st1'),true,'status: L is listed and ready to start');
select is(pg_temp.op($$select public.r0_legacy_review_status('e7410000-0000-4000-8000-00000000000e')$$),
 '{"listed": false}'::jsonb,'status: X is not listed');
select is((pg_temp.op($$select public.r0_legacy_review_status('e7410000-0000-4000-8000-00000000000b')$$)->>'live_attempt')::boolean,true,
 'status reports M''s live attempt');
select throws_ok($$select pg_temp.start('e7410000-0000-4000-8000-00000000000e','s-x')$$,
 'P0001','Provider is not on the legacy review list','a provider outside the list must apply');
select throws_ok($$select pg_temp.start('e7410000-0000-4000-8000-00000000000a','s-blank',' ')$$,
 'P0001','Reason and idempotency key required','a reason is required');
select throws_ok($$select pg_temp.start('e7410000-0000-4000-8000-00000000000b','s-m')$$,
 'P0001','Close the live access invitation before starting application onboarding','a live access attempt blocks the start');
select throws_ok($$select pg_temp.start('e7410000-0000-4000-8000-00000000000c','s-e')$$,
 'P0001','Excluded provider cannot start onboarding','an excluded provider is refused');
select throws_ok($$select pg_temp.start('e7410000-0000-4000-8000-00000000000d','s-a')$$,
 'P0001','Provider has an open application; start review from it','a provider with an open application uses it');
select is((select count(*)::int from public.vendor_onboarding where contractor_id in ('e7410000-0000-4000-8000-00000000000b',
  'e7410000-0000-4000-8000-00000000000c','e7410000-0000-4000-8000-00000000000d','e7410000-0000-4000-8000-00000000000e')),0,
 'refusals created no onboarding');

select throws_ok($$select pg_temp.op('select public.vendor_authorize_renewal_upload(''license'',''e7410000-0000-4000-8000-00000000000a'')')$$,
 'P0001','Renewal documents are accepted only for active or suspended providers','no operator upload before the legacy review starts');

-- Start ------------------------------------------------------------------------------------------
insert into t values ('s1', pg_temp.start('e7410000-0000-4000-8000-00000000000a','s-l-1'));
select is((select v->>'created' from t where k='s1'),'true','the operator starts legacy review for L');
create temp table app as select * from public.vendor_applications where id=(select (v->>'application_id')::uuid from t where k='s1');
select is((select contractor_id from app),'e7410000-0000-4000-8000-00000000000a'::uuid,'the operator record is linked to L');
select is((select email||'|'||first_name||' '||last_name||'|'||business_name||'|'||phone||'|'||years_experience from app),
 'owner-l@example.test|Legacy provider (operator record)|Synthetic Legacy L|555-0100|12','the operator record uses the contact and profile');
select ok((select additional_notes like 'Operator record for legacy provider review (DEC-2026-027).%' from app),
 'the operator record says it was not the provider''s submission');
select is((select status||':'||revision from public.vendor_onboarding where contractor_id='e7410000-0000-4000-8000-00000000000a'),'review:1',
 'onboarding opens in review at revision 1');
select is((select v.revision from public.vendor_onboarding o join public.vendor_application_versions v on v.id=o.application_version_id
  where o.contractor_id='e7410000-0000-4000-8000-00000000000a'),1,'onboarding is bound to the operator record''s version');
select is((select count(*)::int from public.vendor_onboarding_review_starts where application_id=(select id from app)),1,
 'the review start is recorded for the operator record');
select is((select count(*)::int from public.contractors where name='Synthetic Legacy L'),1,'no second provider record');
select is((select count(*)::int from public.notifications),(select n from notices),'no new-application notice was raised');
select ok(not exists(select 1 from private.r0_application_notifications where application_id=(select id from app)),
 'no owner notification record was created');
select ok((select user_id='e7400000-0000-4000-8000-000000000002' and is_active and marketing_enabled and bio='Real description'
  from public.contractors where id='e7410000-0000-4000-8000-00000000000a'),'account, profile and flags are unchanged');
select ok(not private.vendor_matching_eligible('e7410000-0000-4000-8000-00000000000a'),'review is not eligibility');
select ok(not public.r0_provider_listable('e7410000-0000-4000-8000-00000000000a'),'review is not a listing');
select is((select count(*)::int from public.vendor_compliance_evidence where contractor_id='e7410000-0000-4000-8000-00000000000a'),0,
 'no evidence is created');
select is((select count(*)::int from private.r0_provider_access_events where contractor_id='e7410000-0000-4000-8000-00000000000a'
  and event='onboarding_review_started'),1,'the access history records the start');
select is(pg_temp.start('e7410000-0000-4000-8000-00000000000a','s-l-1')->>'application_id',(select id::text from app),
 'an exact replay returns the same record');
select throws_ok($$select pg_temp.start('e7410000-0000-4000-8000-00000000000a','s-l-2')$$,
 'P0001','Legacy review already started','a second start is refused');
select is((select count(*)::int from public.vendor_applications where contractor_id='e7410000-0000-4000-8000-00000000000a'),1,
 'replays wrote one operator record');
select is((pg_temp.op($$select public.r0_legacy_review_status('e7410000-0000-4000-8000-00000000000a')$$)->>'started')::boolean,true,
 'status reads the started review');
select is((pg_temp.op(format('select public.vendor_onboarding_intake_status(%L)',(select id from app)))->>'review_started')::boolean,true,
 'the applications queue reads the record as in review');

-- Checklist, activation and listing are unchanged -----------------------------------------------
insert into t values ('c1', pg_temp.op($$select public.vendor_onboarding_checklist('e7410000-0000-4000-8000-00000000000a')$$));
select is((select (v->>'version_current')::boolean and (v->>'application_open')::boolean and v->>'onboarding_status'='review'
  from t where k='c1'),true,'the checklist reads the operator record');
select throws_ok($$select pg_temp.op('select to_jsonb(public.vendor_decide_onboarding(''e7410000-0000-4000-8000-00000000000a'',1,''activate'',''Too early'',''act-early''))')$$,
 'P0001','Activation checklist incomplete or expired','activation still requires the full checklist');
-- License and insurance come from documents the operator uploads for the open review.
select is((pg_temp.op($$select public.vendor_renewal_document_overview('e7410000-0000-4000-8000-00000000000a')$$)->>'operator_upload')::boolean,true,
 'the operator upload applies to the open legacy review');
select is(pg_temp.op($$select public.vendor_authorize_renewal_upload('license','e7410000-0000-4000-8000-00000000000a')$$)->>'submitted_as','operator',
 'the operator may upload for the open legacy review');
select throws_ok($$select pg_temp.user(2,'select public.vendor_authorize_renewal_upload(''license'')')$$,
 'P0001','Renewal documents are accepted only for active or suspended providers','the provider still cannot submit while in review');
insert into storage.objects(bucket_id,name,metadata)
 select 'vendor-documents','renewals/e7410000-0000-4000-8000-00000000000a/'||k||'/e7430000-0000-4000-8000-00000000000'||n||'-'||k||'.pdf',
        '{"size":2048,"mimetype":"application/pdf"}'::jsonb
   from (values ('license',1),('insurance',2)) x(k,n);
select is(pg_temp.op(format('select public.vendor_submit_renewal_document(%L,%L)',
   'renewals/e7410000-0000-4000-8000-00000000000a/'||k||'/e7430000-0000-4000-8000-00000000000'||n||'-'||k||'.pdf',
   'e7410000-0000-4000-8000-00000000000a'))->>'recorded','true','the operator uploads the held '||k||' document')
 from (values ('license',1),('insurance',2)) x(k,n);
select throws_ok($$select pg_temp.op('select public.vendor_record_checklist_evidence(''e7410000-0000-4000-8000-00000000000a'',''license'',''v1'',''Owner folder: legacy/L/license'','''||now()::text||''','''||(now()+interval '1 year')::text||''',null,''ev-outside'')')$$,
 'P0001','Document must belong to the current provider application','an outside reference is not license evidence');
select pg_temp.op(format('select public.vendor_record_checklist_evidence(%L,%L,''v1'',%L,%L,%L,null,%L)',
   'e7410000-0000-4000-8000-00000000000a',k,
   case k when 'license' then 'renewals/e7410000-0000-4000-8000-00000000000a/license/e7430000-0000-4000-8000-000000000001-license.pdf'
          when 'insurance' then 'renewals/e7410000-0000-4000-8000-00000000000a/insurance/e7430000-0000-4000-8000-000000000002-insurance.pdf'
          else 'Owner folder: legacy/L/'||k end,
   now()-interval '1 minute',case when k in ('license','insurance') then now()+interval '1 year' end,'ev-'||k))
 from unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k;
select is((select count(*)::int from public.vendor_renewal_document_decisions x join public.vendor_renewal_documents d on d.id=x.document_id
  where d.contractor_id='e7410000-0000-4000-8000-00000000000a' and x.outcome='accepted'),2,'both uploaded documents are accepted as evidence');
select ok(public.vendor_evidence_current('e7410000-0000-4000-8000-00000000000a',now()),'all nine checklist items are current');
select is(pg_temp.op($$select to_jsonb(public.vendor_decide_onboarding('e7410000-0000-4000-8000-00000000000a',1,'activate','Checklist complete (synthetic)','act-l'))$$),
 '2'::jsonb,'the operator activates the legacy provider');
select is((select outcome from public.vendor_role_decisions where contractor_id='e7410000-0000-4000-8000-00000000000a'),'inherited_link',
 'activation keeps the access-bound account without a second grant');
select ok(private.vendor_matching_eligible('e7410000-0000-4000-8000-00000000000a'),'the activated provider is eligible');
select ok(public.r0_provider_listable('e7410000-0000-4000-8000-00000000000a'),'the activated provider with content is publicly listed');
select ok(not private.r0_legacy_review_open('e7410000-0000-4000-8000-00000000000a'),'the legacy upload window closes at activation');
select is((pg_temp.op($$select public.vendor_renewal_document_overview('e7410000-0000-4000-8000-00000000000a')$$)->>'operator_upload')::boolean,true,
 'the active provider keeps the ordinary operator upload');

-- Applicants are unaffected -------------------------------------------------------------------------
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,years_experience,services,status)
 values ('e7420000-0000-4000-8000-00000000000f','Synthetic New N','Nia','New','new-n@example.test','synthetic',5,'{}','pending');
select ok(exists(select 1 from private.r0_application_notifications where application_id='e7420000-0000-4000-8000-00000000000f'),
 'a real application still records its owner notification');
select ok((select count(*)::int from public.notifications) > (select n from notices),'a real application still raises the operator notice');
select ok(not private.r0_legacy_intake_active(),'the intake flag does not outlive the start');

select * from finish();
rollback;
