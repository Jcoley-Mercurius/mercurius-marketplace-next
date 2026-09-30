-- TRACE-104 (R0.4): owner-notification delivery ledger and recovery, invitation attention,
-- truthful public listing, vendor listing readback and applicant non-access.
-- Synthetic identities only. Every change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 admin operator, 2 homeowner (non-admin), 3 vendor owning the eligible provider,
-- 4 applicant who holds an account but only applied.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('e7100000-0000-4000-8000-000000000001','operator@example.test',now(),'{}'),
 ('e7100000-0000-4000-8000-000000000002','homeowner@example.test',now(),'{}'),
 ('e7100000-0000-4000-8000-000000000003','vendor@example.test',now(),'{}'),
 ('e7100000-0000-4000-8000-000000000004','applicant@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values ('e7100000-0000-4000-8000-000000000001','admin');

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
create function pg_temp.svc(p_sql text) returns jsonb language sql as $$ select pg_temp.run(null,'service_role',p_sql) $$;
create function pg_temp.op(p_sql text) returns jsonb language sql as $$
 select pg_temp.run('e7100000-0000-4000-8000-000000000001','authenticated',p_sql) $$;
create function pg_temp.user(p_n int, p_sql text) returns jsonb language sql as $$
 select pg_temp.run(('e7100000-0000-4000-8000-00000000000'||p_n)::uuid,'authenticated',p_sql) $$;
create function pg_temp.state(p_app uuid) returns text language sql as $$
 select n->>'state' from jsonb_array_elements(pg_temp.op('select public.r0_application_notification_overview()')->'items') n
 where (n->>'application_id')::uuid=p_app $$;

-- Least privilege ------------------------------------------------------------------
select ok(not has_table_privilege(r,'private.r0_application_notifications','SELECT')
      and not has_table_privilege(r,'private.r0_public_listing_exclusions','SELECT')
      and not has_table_privilege(r,'private.r0_application_notification_events','SELECT'),
 'no client or service role reads the private ledgers: '||r)
 from unnest(array['anon','authenticated','service_role']) r;
select ok(has_function_privilege('service_role','public.r0_claim_application_notification(uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.r0_claim_application_notification(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.r0_claim_application_notification(uuid,text)','EXECUTE'),
 'only the service key claims a notification send');
select ok(has_function_privilege('service_role','public.r0_record_application_notification(uuid,uuid,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.r0_record_application_notification(uuid,uuid,text,text,text)','EXECUTE'),
 'only the service key records a notification outcome');
select ok(not has_function_privilege('anon',f,'EXECUTE') and not has_function_privilege('service_role',f,'EXECUTE')
      and has_function_privilege('authenticated',f,'EXECUTE'), 'operator command is signed-in only: '||f)
 from unnest(array['public.r0_request_application_notification_resend(uuid,boolean)',
  'public.r0_acknowledge_application_notification(uuid,text)','public.r0_application_notification_overview()',
  'public.r0_invitation_attention()','public.r0_set_public_listing_exclusion(uuid,boolean,text)',
  'public.r0_public_listing_inventory()']) f;
select ok(has_function_privilege('anon','public.r0_public_providers(uuid)','EXECUTE')
  and has_function_privilege('anon','public.r0_provider_listable(uuid)','EXECUTE'), 'public listing reads are anonymous');
select ok(not has_function_privilege(r,'private.vendor_matching_eligible(uuid)','EXECUTE'),
 'matching eligibility stays private: '||r) from unnest(array['anon','authenticated','service_role']) r;

-- Submission persists and always has a delivery record --------------------------------
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,years_experience,services,status,document_urls)
 values ('e7110000-0000-4000-8000-000000000001','Synthetic Lawn Co','Ann','Applicant','applicant@example.test','synthetic',3,'{lawn-mowing}','pending','{}'),
        ('e7110000-0000-4000-8000-000000000002','Synthetic Pool Co','Bo','Applicant','second@example.test','synthetic',4,'{pool-service}','pending','{}');
select is((select count(*)::int from private.r0_application_notifications
 where application_id in ('e7110000-0000-4000-8000-000000000001','e7110000-0000-4000-8000-000000000002') and state='pending'),
 2,'each saved application gets a pending delivery record in the same transaction');
select is(pg_temp.state('e7110000-0000-4000-8000-000000000001'),'pending','operator reads the pending state');

-- Initial send: one winner, failure keeps the application visible --------------------
create temp table claim(n int primary key, body jsonb);
grant all on claim to service_role, authenticated;
insert into claim values (1, pg_temp.svc($$select public.r0_claim_application_notification('e7110000-0000-4000-8000-000000000001','initial')$$));
insert into claim values (2, pg_temp.svc($$select public.r0_claim_application_notification('e7110000-0000-4000-8000-000000000001','initial')$$));
select ok((select (body->>'claimed')::boolean from claim where n=1),'first initial claim wins');
select is((select body from claim where n=2),jsonb_build_object('claimed',false,'state','sending'),'a second initial claim does not send');
select is((select body->'application'->>'business_name' from claim where n=1),'Synthetic Lawn Co','claim returns the saved application content');
select throws_ok($$select pg_temp.svc('select public.r0_record_application_notification(''e7110000-0000-4000-8000-000000000001'',gen_random_uuid(),''sent'',''x'',null)')$$,
 '40001','Notification claim is not current','a stale or forged claim cannot record an outcome');
select is(pg_temp.svc(format('select public.r0_record_application_notification(%L,%L,''failed'',null,%L)',
 'e7110000-0000-4000-8000-000000000001',(select body->>'claim_id' from claim where n=1),
 'Resend returned 422: invalid to address owner@example.test'))->>'state','failed','a provider failure is recorded');
select is((select last_error from private.r0_application_notifications where application_id='e7110000-0000-4000-8000-000000000001'),
 'Resend returned 422: invalid to address [address]','the stored error names no address');
select is((select status from public.vendor_applications where id='e7110000-0000-4000-8000-000000000001'),'pending',
 'the application remains saved and pending after the email failed');
select ok((select (n->>'needs_attention')::boolean from jsonb_array_elements(pg_temp.op('select public.r0_application_notification_overview()')->'items') n
 where n->>'application_id'='e7110000-0000-4000-8000-000000000001'),'a failed notification needs attention');

-- Operator authorization ----------------------------------------------------------------
select throws_ok($$select pg_temp.user(2,'select public.r0_application_notification_overview()')$$,'42501',
 'Onboarding operator required','a non-admin cannot read the delivery overview');
select throws_ok($$select pg_temp.user(4,'select public.r0_request_application_notification_resend(''e7110000-0000-4000-8000-000000000001'',true)')$$,
 '42501','Onboarding operator required','an applicant cannot request a resend');

-- Resend from failed: one more attempt, never a duplicate application --------------------
select is(pg_temp.op($$select public.r0_request_application_notification_resend('e7110000-0000-4000-8000-000000000001')$$)->>'state',
 'resend_requested','operator requests a resend of a failed notification');
select is(pg_temp.op($$select public.r0_request_application_notification_resend('e7110000-0000-4000-8000-000000000001')$$)->>'state',
 'resend_requested','a repeated request is idempotent');
select is(pg_temp.svc($$select public.r0_claim_application_notification('e7110000-0000-4000-8000-000000000001','initial')$$)->>'claimed',
 'false','a late initial sender cannot claim a resend');
delete from claim; insert into claim values (1, pg_temp.svc($$select public.r0_claim_application_notification('e7110000-0000-4000-8000-000000000001','resend')$$));
select is((select (body->>'attempt')::int from claim where n=1),2,'the resend is attempt 2');
select is(pg_temp.svc($$select public.r0_claim_application_notification('e7110000-0000-4000-8000-000000000001','resend')$$)->>'claimed',
 'false','a concurrent resend claim does not send twice');
select is(pg_temp.svc(format('select public.r0_record_application_notification(%L,%L,''sent'',''msg_synthetic'',null)',
 'e7110000-0000-4000-8000-000000000001',(select body->>'claim_id' from claim where n=1)))->>'state','sent','the resend is recorded as sent');
select throws_ok($$select pg_temp.op('select public.r0_request_application_notification_resend(''e7110000-0000-4000-8000-000000000001'',true)')$$,
 '55000',null,'a sent notification cannot be resent');
select is((select count(*)::int from public.vendor_applications where email='applicant@example.test'),1,'recovery created no second application');
select is((select count(*)::int from private.r0_application_notification_events where application_id='e7110000-0000-4000-8000-000000000001'),
 6,'every transition is audited; an idempotent repeat adds none');

-- Lost sender: missed, then unknown requires confirmation ----------------------------------
update private.r0_application_notifications set created_at=now()-interval '11 minutes'
 where application_id='e7110000-0000-4000-8000-000000000002';
select is(pg_temp.state('e7110000-0000-4000-8000-000000000002'),'missed','an unclaimed record past 10 minutes reads as missed');
delete from claim; insert into claim values (1, pg_temp.svc($$select public.r0_claim_application_notification('e7110000-0000-4000-8000-000000000002','initial')$$));
update private.r0_application_notifications set claimed_at=now()-interval '11 minutes'
 where application_id='e7110000-0000-4000-8000-000000000002';
select is(pg_temp.state('e7110000-0000-4000-8000-000000000002'),'unknown','a claim without a result past 10 minutes reads as unknown');
select throws_ok($$select pg_temp.op('select public.r0_request_application_notification_resend(''e7110000-0000-4000-8000-000000000002'')')$$,
 '55000','Confirm the earlier email is not in the inbox before resending','an unknown send needs explicit confirmation');
select is(pg_temp.op($$select public.r0_acknowledge_application_notification('e7110000-0000-4000-8000-000000000002','Reviewed in queue')$$)->>'state',
 'acknowledged','the operator can acknowledge instead of resending');
select throws_ok(format('select pg_temp.svc(%L)',format('select public.r0_record_application_notification(%L,%L,''sent'',null,null)',
 'e7110000-0000-4000-8000-000000000002',(select body->>'claim_id' from claim where n=1))),
 '40001',null,'the lost sender cannot overwrite an acknowledgement');
select throws_ok($$select pg_temp.op('select public.r0_acknowledge_application_notification(''e7110000-0000-4000-8000-000000000002'','' '')')$$,
 'P0001','Acknowledgement reason required','acknowledgement needs a reason');

-- Untracked (pre-migration) application ---------------------------------------------------
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls)
 values ('e7110000-0000-4000-8000-000000000003','Synthetic Legacy Co','Cy','Legacy','legacy@example.test','synthetic','pending','{}');
delete from private.r0_application_notifications where application_id='e7110000-0000-4000-8000-000000000003';
select is(pg_temp.state('e7110000-0000-4000-8000-000000000003'),'untracked','an application without a record reads as untracked');
select is(pg_temp.op($$select public.r0_request_application_notification_resend('e7110000-0000-4000-8000-000000000003',true)$$)->>'state',
 'resend_requested','an untracked pending application can be resent after confirmation');

-- Applicant gains no access or visibility by applying ------------------------------------
select is((select count(*)::int from public.user_roles where user_id='e7100000-0000-4000-8000-000000000004' and role='vendor'),0,
 'applying grants no vendor role');
select is((select contractor_id from public.vendor_applications where id='e7110000-0000-4000-8000-000000000001'),null,
 'applying creates no provider record');
select is(pg_temp.user(4,$$select to_jsonb(count(*)) from public.vendor_applications$$),'0'::jsonb,
 'an applicant account cannot read applications');
select is(pg_temp.user(4,$$select public.r0_my_provider_listing()$$),'{"linked": false}'::jsonb,
 'an applicant account has no provider listing');

-- Private documents: admin only ---------------------------------------------------------
insert into storage.objects(bucket_id,name,metadata) values
 ('vendor-documents','e7110000-0000-4000-8000-000000000001/license/synthetic.pdf','{"size":2048,"mimetype":"application/pdf"}');
select is(pg_temp.run(null,'anon',$$select to_jsonb(count(*)) from storage.objects where bucket_id='vendor-documents' and name like 'e7110000-%'$$),
 '0'::jsonb,'anonymous callers cannot read application documents');
select is(pg_temp.user(4,$$select to_jsonb(count(*)) from storage.objects where bucket_id='vendor-documents' and name like 'e7110000-%'$$),
 '0'::jsonb,'the applicant account cannot read application documents');
select is(pg_temp.user(2,$$select to_jsonb(count(*)) from storage.objects where bucket_id='vendor-documents' and name like 'e7110000-%'$$),
 '0'::jsonb,'another signed-in user cannot read application documents');
select is(pg_temp.op($$select to_jsonb(count(*)) from storage.objects where bucket_id='vendor-documents' and name like 'e7110000-%'$$),
 '1'::jsonb,'the admin operator can read application documents');

-- Public listing --------------------------------------------------------------------------
insert into public.service_categories(id,name) values ('r0-synthetic-cat','Synthetic category') on conflict do nothing;
insert into public.services_catalog(id,name,category_id,is_active) values
 ('r0-synthetic-live','Synthetic live','r0-synthetic-cat',true),('r0-synthetic-retired','Synthetic retired','r0-synthetic-cat',false);
-- A: eligible with content; B: active legacy without description; C: onboarding in review;
-- D: eligible test record; E: inactive; F: only a retired catalog service; G: not accepting work.
insert into public.contractors(id,name,bio,services,is_active,marketing_enabled,user_id,email) values
 ('e7120000-0000-4000-8000-00000000000a','Synthetic Eligible Lawn','Real description.','{r0-synthetic-live}',true,true,'e7100000-0000-4000-8000-000000000003','office@synthetic-lawn.invalid'),
 ('e7120000-0000-4000-8000-00000000000b','Synthetic Empty Profile',' ','{r0-synthetic-live}',true,true,null,null),
 ('e7120000-0000-4000-8000-00000000000c','Synthetic Under Review','Description.','{r0-synthetic-live}',true,true,null,null),
 ('e7120000-0000-4000-8000-00000000000d','Test Vendor Demo','Description.','{r0-synthetic-live}',true,true,null,'qa@example.com'),
 ('e7120000-0000-4000-8000-00000000000e','Synthetic Inactive','Description.','{r0-synthetic-live}',false,true,null,null),
 ('e7120000-0000-4000-8000-00000000000f','Synthetic Retired Service','Description.','{r0-synthetic-retired}',true,true,null,null),
 ('e7120000-0000-4000-8000-000000000010','Synthetic Paused','Description.','{r0-synthetic-live}',true,false,null,null);
-- C has onboarding in review (not eligible); A and D are fully eligible through onboarding.
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('e7110000-0000-4000-8000-00000000000a','Synthetic Eligible Lawn','A','Vendor','vendor@example.test','synthetic','e7120000-0000-4000-8000-00000000000a'),
 ('e7110000-0000-4000-8000-00000000000c','Synthetic Under Review','C','Vendor','c@example.test','synthetic','e7120000-0000-4000-8000-00000000000c'),
 ('e7110000-0000-4000-8000-00000000000d','Test Vendor Demo','D','Vendor','qa@example.com','synthetic','e7120000-0000-4000-8000-00000000000d');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select a.contractor_id,v.id,1,case when a.contractor_id='e7120000-0000-4000-8000-00000000000c' then 'review' else 'active' end
 from public.vendor_applications a join public.vendor_application_versions v on v.application_id=a.id
 where a.id in ('e7110000-0000-4000-8000-00000000000a','e7110000-0000-4000-8000-00000000000c','e7110000-0000-4000-8000-00000000000d');
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,k,k||'-v1','Synthetic '||k,now()-interval '1 day',now()+interval '1 year','e7100000-0000-4000-8000-000000000001'
 from public.vendor_onboarding o
 cross join unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k
 where o.contractor_id in ('e7120000-0000-4000-8000-00000000000a','e7120000-0000-4000-8000-00000000000d');
insert into public.contractor_service_zips(contractor_id,zip_code) values ('e7120000-0000-4000-8000-00000000000a','33901');

create function pg_temp.listed() returns text[] language sql as $$
 select coalesce(array_agg(x->>'name' order by x->>'name'),'{}') from jsonb_array_elements(
  pg_temp.run(null,'anon',$q$select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.r0_public_providers() p where p.name like 'Synthetic%' or p.name like 'Test Vendor%'$q$)) x $$;
select is(pg_temp.listed(),array['Synthetic Eligible Lawn','Test Vendor Demo'],
 'before cleanup, only eligible providers with real content are public');
select is(pg_temp.op($$select public.r0_set_public_listing_exclusion('e7120000-0000-4000-8000-00000000000d',true,'Synthetic QA record')$$),
 '{"changed": true, "excluded": true}'::jsonb,'operator excludes a test record with a reason');
select is(pg_temp.op($$select public.r0_set_public_listing_exclusion('e7120000-0000-4000-8000-00000000000d',true,'again')$$),
 '{"changed": false, "excluded": true}'::jsonb,'a repeated exclusion is idempotent');
select is(pg_temp.listed(),array['Synthetic Eligible Lawn'],'excluded, unapproved, empty, inactive, retired-only and paused providers are not public');
select ok(not private.vendor_matching_eligible('e7120000-0000-4000-8000-00000000000d'),'an excluded record cannot be matched either');
select ok(private.vendor_matching_eligible('e7120000-0000-4000-8000-00000000000a'),'an included provider is still eligible');
select is((select count(*)::int from public.contractors where id='e7120000-0000-4000-8000-00000000000d'),1,'exclusion deletes nothing');
select is(pg_temp.run(null,'anon',$$select to_jsonb(array_agg(name order by name)) from public.contractors where name like 'Synthetic%' or name like 'Test Vendor%'$$),
 '["Synthetic Eligible Lawn"]'::jsonb,'anonymous table reads follow the listing rule');
select is(pg_temp.user(2,$$select to_jsonb(count(*)) from public.contractors where id='e7120000-0000-4000-8000-00000000000c'$$),
 '1'::jsonb,'signed-in reads keep active providers for existing history');
select is(pg_temp.run(null,'anon',$$select to_jsonb(count(*)) from public.r0_public_providers('e7120000-0000-4000-8000-00000000000c')$$),
 '0'::jsonb,'an unapproved profile is not returned publicly by ID');
select throws_ok($$select pg_temp.user(3,'select public.r0_set_public_listing_exclusion(''e7120000-0000-4000-8000-00000000000a'',true,''self'')')$$,
 '42501','Onboarding operator required','a vendor cannot change listing exclusions');
select throws_ok($$select pg_temp.op('select public.r0_set_public_listing_exclusion(''e7120000-0000-4000-8000-00000000000a'',true,'''')')$$,
 'P0001','Exclusion reason required','exclusion needs a reason');

create function pg_temp.inv(p_id uuid) returns jsonb language sql as $$
 select x from jsonb_array_elements(pg_temp.op('select public.r0_public_listing_inventory()')->'items') x
 where (x->>'contractor_id')::uuid=p_id $$;
select ok((pg_temp.inv('e7120000-0000-4000-8000-00000000000d')->>'test_signal')::boolean
  and (pg_temp.inv('e7120000-0000-4000-8000-00000000000d')->>'excluded')::boolean,'inventory flags the test record and its exclusion');
select ok(not (pg_temp.inv('e7120000-0000-4000-8000-00000000000a')->>'test_signal')::boolean
  and (pg_temp.inv('e7120000-0000-4000-8000-00000000000a')->>'listable')::boolean,'inventory shows the genuine provider as listed');
select is(pg_temp.inv('e7120000-0000-4000-8000-00000000000b')->>'has_content','false','inventory explains missing content');
select throws_ok($$select pg_temp.user(2,'select public.r0_public_listing_inventory()')$$,'42501',
 'Onboarding operator required','a non-admin cannot read the listing inventory');

-- Vendor readback ---------------------------------------------------------------------------
select is(pg_temp.user(3,$$select public.r0_my_provider_listing()$$)-'contractor_id',
 '{"held": false, "active": true, "linked": true, "listed": true, "approved": true, "has_name": true, "service_zips": ["33901"], "accepting_work": true, "has_description": true, "has_catalog_service": true}'::jsonb,
 'a listed vendor reads its own readiness and coverage');
update public.contractors set bio='' where id='e7120000-0000-4000-8000-00000000000a';
select is(pg_temp.user(3,$$select public.r0_my_provider_listing()$$)->>'listed','false','clearing the description removes the public listing');
select is(pg_temp.user(3,$$select public.r0_my_provider_listing()$$)->>'has_description','false','and the vendor sees why');
select throws_ok($$select pg_temp.run(null,'anon','select public.r0_my_provider_listing()')$$,'42501',null,'anonymous callers have no vendor readback');

-- Invitation attention --------------------------------------------------------------------
insert into public.vendor_invitation_attempts(id,contractor_id,application_version_id,business_key,status,expires_at,created_by)
 select 'e7130000-0000-4000-8000-000000000001',o.contractor_id,o.application_version_id,'synthetic-r0-attention','unknown',now()+interval '1 day','e7100000-0000-4000-8000-000000000001'
 from public.vendor_onboarding o where o.contractor_id='e7120000-0000-4000-8000-00000000000a';
select is((select x->>'reason' from jsonb_array_elements(pg_temp.op('select public.r0_invitation_attention()')->'items') x
 where x->>'attempt_id'='e7130000-0000-4000-8000-000000000001'),'uncertain','an unknown Auth result needs attention');
update public.vendor_invitation_attempts set status='revoked' where id='e7130000-0000-4000-8000-000000000001';
select is((select count(*)::int from jsonb_array_elements(pg_temp.op('select public.r0_invitation_attention()')->'items') x
 where x->>'attempt_id'='e7130000-0000-4000-8000-000000000001'),0,'a closed attempt no longer needs attention');
select throws_ok($$select pg_temp.user(3,'select public.r0_invitation_attention()')$$,'42501',
 'Onboarding operator required','a vendor cannot read invitation attention');

select * from finish();
rollback;
