begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-069 synthetic fixtures only. Covers the operator checklist readback and the
-- reviewed checklist evidence command. Document paths are synthetic strings; no real
-- provider, account, document or bank detail is represented here.
insert into auth.users(id,email,email_confirmed_at) values
 ('f1000000-0000-4000-8000-000000000001','checklist-operator@example.invalid',now()),
 ('f1000000-0000-4000-8000-000000000002','checklist-recipient@example.invalid',now()),
 ('f1000000-0000-4000-8000-000000000003','checklist-vendor@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('f1000000-0000-4000-8000-000000000001','admin'),('f1000000-0000-4000-8000-000000000003','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('f2000000-0000-4000-8000-000000000001','Synthetic checklist provider',false,false,null),
 ('f2000000-0000-4000-8000-000000000002','Synthetic rejected provider',false,false,null),
 ('f2000000-0000-4000-8000-000000000003','Synthetic stale-version provider',false,false,null),
 ('f2000000-0000-4000-8000-000000000004','Synthetic unreviewed provider',false,false,null),
 ('f2000000-0000-4000-8000-000000000005','Synthetic expired-evidence provider',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls) values
 ('f3000000-0000-4000-8000-000000000001','Synthetic checklist provider','Test','Checklist','checklist-recipient@example.invalid','synthetic',
  'f2000000-0000-4000-8000-000000000001',array['synthetic/f1/license.pdf','synthetic/f1/insurance.pdf']),
 ('f3000000-0000-4000-8000-000000000002','Synthetic rejected provider','Test','Rejected','checklist-rejected@example.invalid','synthetic',
  'f2000000-0000-4000-8000-000000000002',array[]::text[]),
 ('f3000000-0000-4000-8000-000000000003','Synthetic stale-version provider','Test','Stale','checklist-stale@example.invalid','synthetic',
  'f2000000-0000-4000-8000-000000000003',array[]::text[]),
 ('f3000000-0000-4000-8000-000000000005','Synthetic expired-evidence provider','Test','Expired','checklist-expired@example.invalid','synthetic',
  'f2000000-0000-4000-8000-000000000005',array[]::text[]);

create function pg_temp.version(p_application uuid) returns uuid language sql as $$
 select id from public.vendor_application_versions where application_id=p_application order by revision desc limit 1 $$;
create function pg_temp.item(p_contractor uuid,p_kind text) returns jsonb language sql as $$
 select i from jsonb_array_elements(public.vendor_onboarding_checklist(p_contractor)->'items') i where i->>'kind'=p_kind $$;
create function pg_temp.current_id(p_contractor uuid,p_kind text) returns uuid language sql as $$
 select (pg_temp.item(p_contractor,p_kind)->>'evidence_id')::uuid $$;
create function pg_temp.state() returns text language sql as $$ select md5(concat_ws('|',
 (select count(*) from public.vendor_compliance_evidence),
 (select count(*) from public.vendor_checklist_evidence_requests),
 (select string_agg(contractor_id||':'||status||':'||revision,',' order by contractor_id) from public.vendor_onboarding),
 (select count(*) from public.vendor_onboarding_events),
 (select count(*) from public.vendor_role_decisions),
 (select count(*) from public.user_roles))) $$;
create temp table snap(k text primary key,v text);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1000000-0000-4000-8000-000000000001"}',true);
select public.vendor_begin_review('f2000000-0000-4000-8000-000000000001',pg_temp.version('f3000000-0000-4000-8000-000000000001'));
select public.vendor_begin_review('f2000000-0000-4000-8000-000000000002',pg_temp.version('f3000000-0000-4000-8000-000000000002'));
select public.vendor_begin_review('f2000000-0000-4000-8000-000000000003',pg_temp.version('f3000000-0000-4000-8000-000000000003'));
select public.vendor_begin_review('f2000000-0000-4000-8000-000000000005',pg_temp.version('f3000000-0000-4000-8000-000000000005'));
select public.vendor_decide_onboarding('f2000000-0000-4000-8000-000000000002',1,'reject','Synthetic rejection','checklist-reject');

-- Access.
set local role anon;
select throws_ok($$select public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')$$,
 '42501','permission denied for function vendor_onboarding_checklist','Anonymous caller cannot read the checklist');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','v1','ref',now(),null,null,'k')$$,
 '42501','permission denied for function vendor_record_checklist_evidence','Anonymous caller cannot record evidence');
reset role;
set local role service_role;
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','v1','ref',now(),null,null,'k')$$,
 '42501','permission denied for function vendor_record_checklist_evidence','Service role cannot record evidence');
reset role;
set local role authenticated;
select throws_ok($$select public.vendor_record_evidence('f2000000-0000-4000-8000-000000000001','license','v1','anything',now()-interval '1 hour',now()+interval '1 year')$$,
 '42501','permission denied for function vendor_record_evidence','The raw evidence kernel is no longer a client command');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select throws_ok($$select public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')$$,
 '42501','Onboarding operator required','A vendor cannot read the checklist');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','v1','self',now(),null,null,'k')$$,
 '42501','Onboarding operator required','A vendor cannot record its own evidence');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000004')$$,
 'P0001','Onboarding record not found','A provider without onboarding has no checklist');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000004','identity','v1','ref',now(),null,null,'no-onboarding')$$,
 'P0001','Onboarding review required','A provider without onboarding takes no evidence');

-- Before any evidence.
insert into snap values('before',pg_temp.state());
select is((select count(*) from jsonb_array_elements(public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->'items')
  where value->>'state'='missing'),9::bigint,'All nine checklist items are reported missing');
select is((select string_agg(value->>'kind',',') from jsonb_array_elements(public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->'items')),
 'identity,agreement,coverage,license,insurance,bank_authorization,profile_pricing,availability,test_notification','Items follow the MPS §8 order');
select is((public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->>'checklist_current')::boolean,false,'An empty checklist is not current');
select is(public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->'documents',
 '["synthetic/f1/license.pdf","synthetic/f1/insurance.pdf"]'::jsonb,'The reviewed application documents are reported');
select is((public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->>'account_reviewed')::boolean,false,'No reviewed account is reported');
select is(public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->'last_role_decision','null'::jsonb,'No role decision is reported');
select is(pg_temp.state(),(select v from snap where k='before'),'Reading the checklist wrote nothing');

-- Refusals, each naming the blocking fact.
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','v1','ref',now()-interval '1 minute',null,null,'  ')$$,
 'P0001','Idempotency key required','A key is required');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','background_check','v1','ref',now()-interval '1 minute',null,null,'unknown-kind')$$,
 'P0001','Unknown checklist item','Only the MPS §8 items can be recorded');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity',' ','ref',now()-interval '1 minute',null,null,'blank-version')$$,
 'P0001','Requirement version and evidence reference required','A requirement version is required');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','v1','  ',now()-interval '1 minute',null,null,'blank-ref')$$,
 'P0001','Requirement version and evidence reference required','An evidence reference is required');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','v1','ref',null,null,null,'no-time')$$,
 'P0001','Review time required','A review time is required');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','v1','ref',now()+interval '1 day',null,null,'future')$$,
 'P0001','Current evidence required','Evidence cannot be accepted in the future');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','v1','ref',now()-interval '2 days',now()-interval '1 day',null,'lapsed')$$,
 'P0001','Current evidence required','Already expired evidence cannot be recorded');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','license','state-license-v1','synthetic/other/license.pdf',now()-interval '1 minute',now()+interval '1 year',null,'foreign-doc')$$,
 'P0001','Document must belong to the current provider application','License evidence must be an application document');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','insurance','general-liability-v1','Policy on file',now()-interval '1 minute',now()+interval '1 year',null,'free-text-insurance')$$,
 'P0001','Document must belong to the current provider application','Insurance evidence cannot be a free-text reference');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','license','state-license-v1','synthetic/f1/license.pdf',now()-interval '1 minute',null,null,'no-expiry')$$,
 'P0001','License and insurance evidence requires an expiry','License evidence requires an expiry');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000002','identity','v1','ref',now()-interval '1 minute',null,null,'rejected')$$,
 'P0001','A rejected provider takes no further evidence','A rejected provider takes no evidence');
update public.vendor_applications set business_name='Synthetic stale-version provider v2' where id='f3000000-0000-4000-8000-000000000003';
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000003','identity','v1','ref',now()-interval '1 minute',null,null,'stale-version')$$,
 'P0001','Current application version required','A superseded application version takes no evidence');
select is((public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000003')->>'version_current')::boolean,false,
 'A superseded application version is reported');
select is(pg_temp.state(),(select v from snap where k='before'),'Every refusal wrote nothing');

-- Record, replay and conflict.
select is(public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','identity-check-v1',' Operator verified photo ID ',
  '2026-09-12 12:00+00',null,null,'identity-1')->>'recorded','true','Identity evidence is recorded');
select is(pg_temp.item('f2000000-0000-4000-8000-000000000001','identity')->>'state','current','The recorded item is reported current');
select is(pg_temp.item('f2000000-0000-4000-8000-000000000001','identity')->>'evidence_ref','Operator verified photo ID','The reference is stored trimmed');
select is(public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','identity-check-v1',' Operator verified photo ID ',
  '2026-09-12 12:00+00',null,null,'identity-1')->>'recorded','false','An exact replay reports the original evidence');
select is((select count(*) from public.vendor_compliance_evidence where contractor_id='f2000000-0000-4000-8000-000000000001'),1::bigint,
 'A replay records no second evidence row');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','identity-check-v1','A different reference','2026-09-12 12:00+00',null,null,'identity-1')$$,
 'P0001','Checklist evidence idempotency conflict','The same key with different evidence is refused');
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000005','identity','identity-check-v1',' Operator verified photo ID ','2026-09-12 12:00+00',null,null,'identity-1')$$,
 'P0001','Checklist evidence idempotency conflict','The same key cannot be reused for another provider');

-- Supersession follows the kernel's stale-version guard.
select throws_ok($$select public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','identity-check-v2','Second check','2026-09-12 12:30+00',null,null,'identity-stale')$$,
 'P0001','Stale evidence version','Replacing evidence requires naming the current evidence');
insert into snap values('identity-1',pg_temp.current_id('f2000000-0000-4000-8000-000000000001','identity')::text);
select is(public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','identity','identity-check-v2','Second check',
  '2026-09-12 12:30+00',null,(select v::uuid from snap where k='identity-1'),'identity-2')->>'recorded','true','Current evidence can be superseded');
select is(pg_temp.item('f2000000-0000-4000-8000-000000000001','identity')->>'requirement_version','identity-check-v2','The superseding evidence is reported');

-- The API omits an absent expiry and supersession by name; the call must still resolve.
select is(public.vendor_record_checklist_evidence(p_contractor=>'f2000000-0000-4000-8000-000000000005',p_kind=>'agreement',
  p_requirement=>'agreement-v1',p_reference=>'Synthetic agreement reference',p_accepted=>now()-interval '1 minute',
  p_key=>'named-omitted')->>'recorded','true','A named call omitting the optional arguments resolves and records');

-- License and insurance against application documents.
select is(public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','license','state-license-v1','synthetic/f1/license.pdf',
  now()-interval '1 minute',now()+interval '1 year',null,'license-1')->>'recorded','true','License evidence is recorded from an application document');
select is(public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001','insurance','general-liability-v1','synthetic/f1/insurance.pdf',
  now()-interval '1 minute',now()+interval '1 year',null,'insurance-1')->>'recorded','true','Insurance evidence is recorded from an application document');

-- The remaining items complete the checklist; recording still decides nothing.
do $$ declare requirement text; begin
 foreach requirement in array array['agreement','coverage','bank_authorization','profile_pricing','availability','test_notification'] loop
   perform public.vendor_record_checklist_evidence('f2000000-0000-4000-8000-000000000001',requirement,requirement||'-v1',
     'Synthetic '||requirement||' reference',now()-interval '1 minute',null,null,'complete-'||requirement);
 end loop;
end $$;
select is((public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->>'checklist_current')::boolean,true,'A full checklist is reported current');
select is((select status||':'||revision from public.vendor_onboarding where contractor_id='f2000000-0000-4000-8000-000000000001'),'review:1',
 'Recording evidence changes no onboarding status or revision');
select is((public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->>'eligible')::boolean,false,'Evidence alone makes no provider eligible');
select is((select count(*) from public.user_roles where user_id='f1000000-0000-4000-8000-000000000002' and role='vendor'),0::bigint,
 'Evidence alone grants no role');
select is((public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->>'scoped_compliance_current')::boolean,false,
 'Document-recorded license and insurance are not reported as scoped compliance');

-- The decision readback after a reviewed link and activation.
select public.vendor_link_existing_account('f2000000-0000-4000-8000-000000000001',1,'f1000000-0000-4000-8000-000000000002',
 'Applicant already holds a Mercurius account','checklist-link');
select is(public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->>'account_email','checklist-recipient@example.invalid',
 'The reviewed account is reported');
select public.vendor_decide_onboarding('f2000000-0000-4000-8000-000000000001',2,'activate','All synthetic checks reviewed','checklist-activate');
select is(public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->>'onboarding_status','active','Activation is read back');
select is(public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->'last_role_decision'->>'outcome','granted',
 'The activation role outcome is read back');
select is((public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->>'vendor_role_held')::boolean,true,'The granted role is read back');
select is(public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->'events'->0->>'action','activate',
 'The newest onboarding event is listed first');

-- Item states the command cannot create are still reported truthfully.
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 values('f2000000-0000-4000-8000-000000000005',pg_temp.version('f3000000-0000-4000-8000-000000000005'),'identity','identity-check-v1',
  'Synthetic lapsed check',now()-interval '2 days',now()-interval '1 day','f1000000-0000-4000-8000-000000000001');
select is(pg_temp.item('f2000000-0000-4000-8000-000000000005','identity')->>'state','expired','Lapsed evidence is reported expired');
update public.vendor_applications set business_name='Synthetic checklist provider v2' where id='f3000000-0000-4000-8000-000000000001';
select public.vendor_begin_review('f2000000-0000-4000-8000-000000000001',pg_temp.version('f3000000-0000-4000-8000-000000000001'));
select is(pg_temp.item('f2000000-0000-4000-8000-000000000001','identity')->>'state','superseded_version',
 'Evidence bound to a previous application version is reported as such');
select is((public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->>'checklist_current')::boolean,false,
 'A new application revision leaves the checklist incomplete');

-- Evidence requests are private and append-only.
set local role authenticated;
select throws_ok($$select * from public.vendor_checklist_evidence_requests$$,'42501','permission denied for table vendor_checklist_evidence_requests',
 'Clients cannot read evidence requests directly');
reset role;
select throws_ok($$update public.vendor_checklist_evidence_requests set evidence_ref='Rewritten'$$,'55000',null,'An evidence request cannot be rewritten');
select throws_ok($$delete from public.vendor_checklist_evidence_requests$$,'55000',null,'An evidence request cannot be deleted');

select * from finish();
rollback;
