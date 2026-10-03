-- TRACE-105: onboarding review for an access-bound existing provider. A real application
-- from the confirmed contact opens review on the existing record (never a second one),
-- then the unchanged checklist, activation and listing rules apply.
-- Synthetic identities only. Every change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator; 2 owner of provider P (bound through access); 3 unrelated signed-in user;
-- 4 owner of provider Q (contact recorded, never bound).
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('e7300000-0000-4000-8000-000000000001','operator@example.test',now(),'{}'),
 ('e7300000-0000-4000-8000-000000000002','owner-p@example.test',now(),'{}'),
 ('e7300000-0000-4000-8000-000000000003','someone@example.test',now(),'{}'),
 ('e7300000-0000-4000-8000-000000000004','owner-q@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values ('e7300000-0000-4000-8000-000000000001','admin');

insert into public.contractors(id,name,bio,services,is_active,marketing_enabled,email,user_id)
 select x.id::uuid,x.name,'Real description',array[(select id from public.services_catalog where is_active order by id limit 1)],true,true,null,null
   from (values ('e7310000-0000-4000-8000-00000000000a','Synthetic Legacy P'),
                ('e7310000-0000-4000-8000-00000000000b','Synthetic Legacy Q')) x(id,name);

-- Applications: P from the confirmed contact (case differs), P2 from another address,
-- Q from Q's contact, N from a new applicant.
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,years_experience,services,status,document_urls)
 values
 ('e7320000-0000-4000-8000-00000000000a','Synthetic Legacy P','Pat','Owner',' Owner-P@Example.test','synthetic',5,'{}','pending',
   '{e7320000-0000-4000-8000-00000000000a/license/l.pdf,e7320000-0000-4000-8000-00000000000a/insurance/i.pdf}'),
 ('e7320000-0000-4000-8000-00000000000b','Synthetic Legacy P','Pat','Other','other-p@example.test','synthetic',5,'{}','pending','{}'),
 ('e7320000-0000-4000-8000-00000000000c','Synthetic Legacy Q','Quin','Owner','owner-q@example.test','synthetic',5,'{}','pending','{}'),
 ('e7320000-0000-4000-8000-00000000000d','Synthetic New N','Nia','New','new-n@example.test','synthetic',5,'{}','pending','{}');

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
 select pg_temp.run('e7300000-0000-4000-8000-000000000001','authenticated',p_sql) $$;
create function pg_temp.user(p_n int, p_sql text) returns jsonb language sql as $$
 select pg_temp.run(('e7300000-0000-4000-8000-00000000000'||p_n)::uuid,'authenticated',p_sql) $$;
create function pg_temp.version(p_app uuid) returns uuid language sql as $$
 select id from public.vendor_application_versions where application_id=p_app order by revision desc limit 1 $$;
create function pg_temp.start(p_app uuid, p_contractor uuid, p_key text, p_version uuid default null) returns jsonb language sql as $$
 select pg_temp.op(format('select public.r0_start_existing_provider_review(%L,%L,%L,''Existing provider applied (synthetic)'',%L)',
   p_app,coalesce(p_version,pg_temp.version(p_app)),p_contractor,p_key)) $$;
create function pg_temp.start_new(p_app uuid, p_key text) returns jsonb language sql as $$
 select pg_temp.op(format('select public.vendor_start_onboarding_review(%L,%L,''New applicant (synthetic)'',%L)',
   p_app,pg_temp.version(p_app),p_key)) $$;
create temp table t(k text primary key, v jsonb);
grant all on t to authenticated;

-- Setup access for P (contact, existing-account attempt, acceptance, binding); contact only for Q.
select pg_temp.op($$select public.r0_record_provider_contact('e7310000-0000-4000-8000-00000000000a','owner-p@example.test','Owner confirmed (synthetic)','R0 access','c-p')$$);
select pg_temp.op($$select public.r0_record_provider_contact('e7310000-0000-4000-8000-00000000000b','owner-q@example.test','Owner confirmed (synthetic)','R0 access','c-q')$$);
insert into t values ('p1', pg_temp.op(format('select public.r0_prepare_provider_access(%L,''p-p-1'',%L,%L)',
  'e7310000-0000-4000-8000-00000000000a',now()+interval '7 days','e7300000-0000-4000-8000-000000000002')));
select pg_temp.user(2,format('select public.r0_accept_provider_access(%L)',(select v->>'attempt_id' from t where k='p1')));
select is(pg_temp.op(format('select public.r0_bind_provider_access(%L,%L,''Bound (synthetic)'',''b-p'')',
  'e7310000-0000-4000-8000-00000000000a',(select v->>'attempt_id' from t where k='p1')))->>'recorded','true','setup: P is bound through access');
select ok(not private.vendor_matching_eligible('e7310000-0000-4000-8000-00000000000a'),'setup access alone is not eligibility');

-- Least privilege -------------------------------------------------------------------------
select ok(has_function_privilege('authenticated','public.r0_start_existing_provider_review(uuid,uuid,uuid,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.r0_start_existing_provider_review(uuid,uuid,uuid,text,text)','EXECUTE')
  and not has_function_privilege('service_role','public.r0_start_existing_provider_review(uuid,uuid,uuid,text,text)','EXECUTE'),
 'the start is signed-in only');
select ok(not has_function_privilege(r,'private.r0_review_start_existing_guard()','EXECUTE'),'no client runs the guard: '||r)
 from unnest(array['anon','authenticated','service_role']) r;
select throws_ok(format('select pg_temp.user(3,%L)',format('select public.r0_start_existing_provider_review(%L,%L,%L,''r'',''k'')',
  'e7320000-0000-4000-8000-00000000000a',pg_temp.version('e7320000-0000-4000-8000-00000000000a'),'e7310000-0000-4000-8000-00000000000a')),
 '42501','Onboarding operator required','a non-operator cannot start review');
select throws_ok(format('select pg_temp.user(2,%L)',format('select public.vendor_onboarding_intake_status(%L)','e7320000-0000-4000-8000-00000000000a')),
 '42501','Onboarding operator required','the provider cannot read the intake status');

-- Readback --------------------------------------------------------------------------------
insert into t values ('i1', pg_temp.op($$select public.vendor_onboarding_intake_status('e7320000-0000-4000-8000-00000000000a')$$));
select is((select v->'existing_provider'->>'contractor_id' from t where k='i1'),'e7310000-0000-4000-8000-00000000000a',
 'intake status names the existing provider whose contact applied');
select is((select (v->'existing_provider'->>'bound')::boolean and not (v->'existing_provider'->>'onboarding')::boolean from t where k='i1'),true,
 'intake status reports the binding and no onboarding yet');
select ok(pg_temp.op($$select public.vendor_onboarding_intake_status('e7320000-0000-4000-8000-00000000000d')$$)->'existing_provider' = 'null'::jsonb,
 'a new applicant has no existing provider');

-- Refusals -----------------------------------------------------------------------------------
select throws_ok($$select pg_temp.start_new('e7320000-0000-4000-8000-00000000000a','new-p')$$,
 'P0001','Application is from an existing provider; start review for that provider',
 'TRACE-065 cannot create a second provider for an existing provider''s application');
select is((select count(*)::int from public.contractors where name='Synthetic Legacy P'),1,'no duplicate provider record was left');
select throws_ok($$select pg_temp.start('e7320000-0000-4000-8000-00000000000b','e7310000-0000-4000-8000-00000000000a','s-p-other')$$,
 'P0001','Application email does not match the confirmed contact','an application from another address is refused');
select throws_ok($$select pg_temp.start('e7320000-0000-4000-8000-00000000000c','e7310000-0000-4000-8000-00000000000b','s-q')$$,
 'P0001','Reviewed access binding required','a provider with a contact but no binding is refused');
select throws_ok($$select pg_temp.start('e7320000-0000-4000-8000-00000000000a','e7310000-0000-4000-8000-00000000000a','s-p-stale',
  'e7320000-0000-4000-8000-0000000000ff')$$,
 'P0001','Latest application version required','a stale or unknown version is refused');
select throws_ok(format('select pg_temp.op(%L)',format('select public.r0_start_existing_provider_review(%L,%L,%L,'' '',''s-p-blank'')',
  'e7320000-0000-4000-8000-00000000000a',pg_temp.version('e7320000-0000-4000-8000-00000000000a'),'e7310000-0000-4000-8000-00000000000a')),
 'P0001','Reason and idempotency key required','a reason is required');
select ok(not exists(select 1 from public.vendor_onboarding where contractor_id='e7310000-0000-4000-8000-00000000000a'),
 'refusals created no onboarding');

-- Start ----------------------------------------------------------------------------------------
insert into t values ('s1', pg_temp.start('e7320000-0000-4000-8000-00000000000a','e7310000-0000-4000-8000-00000000000a','s-p-1'));
select is((select v->>'created' from t where k='s1'),'true','the operator starts review for the existing provider');
select is((select contractor_id from public.vendor_applications where id='e7320000-0000-4000-8000-00000000000a'),
 'e7310000-0000-4000-8000-00000000000a'::uuid,'the application is linked to the existing record');
select is((select status||':'||revision from public.vendor_onboarding where contractor_id='e7310000-0000-4000-8000-00000000000a'),'review:1',
 'onboarding opens in review at revision 1');
select is((select application_version_id from public.vendor_onboarding where contractor_id='e7310000-0000-4000-8000-00000000000a'),
 pg_temp.version('e7320000-0000-4000-8000-00000000000a'),'onboarding is bound to the latest application version');
select is((select count(*)::int from public.vendor_application_versions where application_id='e7320000-0000-4000-8000-00000000000a'),1,
 'linking the application creates no new application version');
select is((select user_id from public.contractors where id='e7310000-0000-4000-8000-00000000000a'),'e7300000-0000-4000-8000-000000000002'::uuid,
 'the bound account is unchanged');
select ok(exists(select 1 from public.user_roles where user_id='e7300000-0000-4000-8000-000000000002' and role='vendor'),
 'the setup vendor role is unchanged');
select ok((select is_active and marketing_enabled and name='Synthetic Legacy P' and bio='Real description'
  from public.contractors where id='e7310000-0000-4000-8000-00000000000a'),'profile, activity and marketing flags are unchanged');
select ok(not private.vendor_matching_eligible('e7310000-0000-4000-8000-00000000000a'),'review is not eligibility');
select ok(not public.r0_provider_listable('e7310000-0000-4000-8000-00000000000a'),'review is not a listing');
select is((select count(*)::int from public.vendor_compliance_evidence where contractor_id='e7310000-0000-4000-8000-00000000000a'),0,
 'no evidence is created');
select is((select count(*)::int from private.r0_provider_access_events where contractor_id='e7310000-0000-4000-8000-00000000000a'
  and event='onboarding_review_started'),1,'the access history records the start');
select is(pg_temp.start('e7320000-0000-4000-8000-00000000000a','e7310000-0000-4000-8000-00000000000a','s-p-1')->>'contractor_id',
 'e7310000-0000-4000-8000-00000000000a','an exact replay returns the same provider');
select throws_ok($$select pg_temp.start('e7320000-0000-4000-8000-00000000000a','e7310000-0000-4000-8000-00000000000b','s-p-1')$$,
 'P0001','Onboarding review idempotency conflict','a replayed key naming another provider conflicts');
select throws_ok($$select pg_temp.start('e7320000-0000-4000-8000-00000000000a','e7310000-0000-4000-8000-00000000000a','s-p-2')$$,
 'P0001','Onboarding already exists','a second start for the application is refused');
insert into t values ('i2', pg_temp.op($$select public.vendor_onboarding_intake_status('e7320000-0000-4000-8000-00000000000a')$$));
select is((select (v->>'review_started')::boolean and v->>'contractor_id'='e7310000-0000-4000-8000-00000000000a' from t where k='i2'),true,
 'intake status reads the started review on the existing record');

-- Checklist, activation and listing are unchanged ----------------------------------------------
insert into t values ('c1', pg_temp.op($$select public.vendor_onboarding_checklist('e7310000-0000-4000-8000-00000000000a')$$));
select is((select (v->>'version_current')::boolean and (v->>'application_open')::boolean and (v->>'account_linked')::boolean
  and jsonb_array_length(v->'documents')=2 from t where k='c1'),true,'the checklist reads the linked application and its documents');
select throws_ok($$select pg_temp.op('select to_jsonb(public.vendor_decide_onboarding(''e7310000-0000-4000-8000-00000000000a'',1,''activate'',''Too early'',''act-early''))')$$,
 'P0001','Activation checklist incomplete or expired','activation still requires the full checklist');
select pg_temp.op(format('select public.vendor_record_checklist_evidence(%L,%L,''v1'',%L,%L,%L,null,%L)',
   'e7310000-0000-4000-8000-00000000000a',k,
   case k when 'license' then 'e7320000-0000-4000-8000-00000000000a/license/l.pdf'
          when 'insurance' then 'e7320000-0000-4000-8000-00000000000a/insurance/i.pdf' else 'ref-'||k end,
   now()-interval '1 minute',case when k in ('license','insurance') then now()+interval '1 year' end,'ev-'||k))
 from unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k;
select ok(public.vendor_evidence_current('e7310000-0000-4000-8000-00000000000a',now()),'all nine checklist items are current');
select is(pg_temp.op($$select to_jsonb(public.vendor_decide_onboarding('e7310000-0000-4000-8000-00000000000a',1,'activate','Checklist complete (synthetic)','act-p'))$$),
 '2'::jsonb,'the operator activates the existing provider');
select is((select outcome from public.vendor_role_decisions where contractor_id='e7310000-0000-4000-8000-00000000000a'),'inherited_link',
 'activation records the access-bound account without a second grant');
select ok(exists(select 1 from public.user_roles where user_id='e7300000-0000-4000-8000-000000000002' and role='vendor'),
 'the vendor role is still held');
select ok(private.vendor_matching_eligible('e7310000-0000-4000-8000-00000000000a'),'the activated provider is eligible');
select ok(public.r0_provider_listable('e7310000-0000-4000-8000-00000000000a'),'the activated provider with content is publicly listed');
select is(pg_temp.user(2,'select public.r0_my_provider_listing()')->>'listed','true','the provider''s own listing readback says listed');
select throws_ok($$select pg_temp.op('select public.r0_release_provider_access(''e7310000-0000-4000-8000-00000000000a'',''x'',''rel-p'')')$$,
 'P0001','Suspend an active provider before releasing its account','an active provider''s binding cannot be released');

-- New applicants are unaffected ----------------------------------------------------------------
select is(pg_temp.start_new('e7320000-0000-4000-8000-00000000000d','new-n')->>'created','true','a new applicant still opens review on a new record');
select throws_ok($$select pg_temp.start('e7320000-0000-4000-8000-00000000000d','e7310000-0000-4000-8000-00000000000b','s-n')$$,
 'P0001','Onboarding already exists','the existing-provider start does not take over a started application');

select * from finish();
rollback;
