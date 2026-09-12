begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-065 synthetic fixtures only.
insert into auth.users(id,email) values
 ('e1000000-0000-4000-8000-000000000001','intake-operator@example.invalid'),
 ('e1000000-0000-4000-8000-000000000002','intake-operator-2@example.invalid'),
 ('e1000000-0000-4000-8000-000000000003','intake-vendor@example.invalid');
insert into public.user_roles(user_id,role) values
 ('e1000000-0000-4000-8000-000000000001','admin'),('e1000000-0000-4000-8000-000000000002','admin'),
 ('e1000000-0000-4000-8000-000000000003','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('e2000000-0000-4000-8000-000000000001','Synthetic legacy provider',true,true),
 ('e2000000-0000-4000-8000-000000000002','Synthetic cut-over provider',false,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,contractor_id) values
 ('e3000000-0000-4000-8000-000000000001','Synthetic New Applicant','Test','Applicant','new-applicant@example.invalid','synthetic-phone','pending',null),
 ('e3000000-0000-4000-8000-000000000002','Synthetic State Applicant','Test','State','state-applicant@example.invalid','synthetic','pending',null),
 ('e3000000-0000-4000-8000-000000000003','Synthetic Rejected Applicant','Test','Rejected','rejected@example.invalid','synthetic','rejected',null),
 ('e3000000-0000-4000-8000-000000000004','Synthetic Abandoned Applicant','Test','Abandoned','abandoned@example.invalid','synthetic','abandoned',null),
 ('e3000000-0000-4000-8000-000000000005','Synthetic legacy provider','Test','Legacy','legacy@example.invalid','synthetic','approved','e2000000-0000-4000-8000-000000000001'),
 ('e3000000-0000-4000-8000-000000000006','Synthetic cut-over provider','Test','Cutover','cutover@example.invalid','synthetic','approved','e2000000-0000-4000-8000-000000000002'),
 ('e3000000-0000-4000-8000-000000000007','Synthetic Other Applicant','Test','Other','other-applicant@example.invalid','synthetic','pending',null);

-- Definer helper so role-switched assertions reach the RPC gate, not a table grant.
create function pg_temp.latest(p_application uuid) returns uuid language sql security definer as $$
 select id from public.vendor_application_versions where application_id=p_application order by revision desc limit 1 $$;
-- Fingerprint of every row this command could write.
create function pg_temp.state() returns text language sql as $$ select md5(concat_ws('|',
 (select count(*) from public.contractors),
 (select string_agg(id||':'||coalesce(contractor_id::text,'-')||':'||status,',' order by id) from public.vendor_applications),
 (select string_agg(contractor_id||':'||status||':'||revision||':'||application_version_id,',' order by contractor_id) from public.vendor_onboarding),
 (select count(*) from public.vendor_onboarding_events),
 (select count(*) from public.vendor_onboarding_review_starts),
 (select count(*) from public.vendor_application_versions),
 (select count(*) from public.user_roles))) $$;
create temp table snap(k text primary key,v text);
create temp table fixture(k text primary key,v jsonb);
grant select,insert on snap,fixture to anon,authenticated,service_role;
grant execute on function pg_temp.latest(uuid) to anon,authenticated,service_role;

-- Access: denied before any key or application lookup.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001"}',true);
set local role anon;
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'Synthetic','anon-key')$$,
 '42501','permission denied for function vendor_start_onboarding_review','Anonymous caller cannot start onboarding');
reset role;
set local role service_role;
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'Synthetic','service-key')$$,
 '42501','permission denied for function vendor_start_onboarding_review','Service role cannot start onboarding');
select throws_ok($$select * from public.vendor_onboarding_review_starts$$,'42501','permission denied for table vendor_onboarding_review_starts','Service role cannot read review-start requests');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'Synthetic','vendor-key')$$,
 '42501','Onboarding operator required','Vendor cannot start onboarding');
select throws_ok($$select public.vendor_onboarding_intake_status('e3000000-0000-4000-8000-000000000001')$$,
 '42501','Onboarding operator required','Vendor cannot read intake status');
select throws_ok($$select * from public.vendor_onboarding_review_starts$$,'42501','permission denied for table vendor_onboarding_review_starts','Authenticated caller cannot read review-start requests');
select throws_ok($$insert into public.vendor_onboarding_review_starts(business_key,application_id,expected_version_id,contractor_id,actor,reason)
 values('forged','e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','Forged')$$,
 '42501','permission denied for table vendor_onboarding_review_starts','Authenticated caller cannot write review-start requests');
reset role;
select is((select count(*) from public.vendor_onboarding_review_starts),0::bigint,'Denied callers wrote nothing');

-- Validation.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001"}',true);
insert into snap values('validation',pg_temp.state());
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'  ','blank-reason')$$,
 'P0001','Reason and idempotency key required','Blank reason rejected');
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'Synthetic review',' ')$$,
 'P0001','Reason and idempotency key required','Blank key rejected');
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',null,'Synthetic review','null-version')$$,
 'P0001','Latest application version required','Missing version rejected');
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000007'),'Synthetic review','foreign-version')$$,
 'P0001','Latest application version required','Another application''s version rejected');
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000003',pg_temp.latest('e3000000-0000-4000-8000-000000000003'),'Synthetic review','rejected-app')$$,
 'P0001','Closed application cannot start onboarding','Rejected application rejected');
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000004',pg_temp.latest('e3000000-0000-4000-8000-000000000004'),'Synthetic review','abandoned-app')$$,
 'P0001','Closed application cannot start onboarding','Abandoned application rejected');
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-00000000000f',null,'Synthetic review','missing-app')$$,
 'P0001','Application not found','Unknown application rejected');
select is(pg_temp.state(),(select v from snap where k='validation'),'Rejected validation wrote nothing');
insert into snap values('stale-version',pg_temp.latest('e3000000-0000-4000-8000-000000000001'));
update public.vendor_applications set phone='synthetic-phone-2' where id='e3000000-0000-4000-8000-000000000001';
select isnt(pg_temp.latest('e3000000-0000-4000-8000-000000000001')::text,(select v from snap where k='stale-version'),'Intake edit creates a new version');
insert into snap values('stale',pg_temp.state());
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',(select v::uuid from snap where k='stale-version'),'Synthetic review','stale-version')$$,
 'P0001','Latest application version required','Stale version rejected');
select is(pg_temp.state(),(select v from snap where k='stale'),'Stale version wrote nothing');

-- Create: as the authenticated operator through the granted RPC.
select is((public.vendor_onboarding_intake_status('e3000000-0000-4000-8000-000000000001')->>'review_started')::boolean,false,'Readback reports no review before start');
insert into snap values('roles',(select count(*)::text from public.user_roles));
set local role authenticated;
insert into fixture values('created',public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',
 pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'  Synthetic operator review  ','start-a'));
reset role;
select is((select v->>'created' from fixture where k='created'),'true','Start reports creation');
select is((select v->>'onboarding_status' from fixture where k='created'),'review','Start reports review status');
select is((select v->>'onboarding_revision' from fixture where k='created'),'1','Start reports revision 1');
insert into snap values('contractor',(select v->>'contractor_id' from fixture where k='created'));
select ok((select not coalesce(is_active,true) and not marketing_enabled and user_id is null and email is null and phone is null
 and name='Synthetic New Applicant' and coalesce(cardinality(services),0)=0 and coalesce(cardinality(badges),0)=0
 from public.contractors where id=(select v::uuid from snap where k='contractor')),'Contractor is hidden, account-less and carries only the business name');
select is((select contractor_id::text from public.vendor_applications where id='e3000000-0000-4000-8000-000000000001'),(select v from snap where k='contractor'),'Application is linked');
select is((select status from public.vendor_applications where id='e3000000-0000-4000-8000-000000000001'),'pending','Legacy application status unchanged');
select ok((select status='review' and revision=1 and application_version_id=pg_temp.latest('e3000000-0000-4000-8000-000000000001')
 from public.vendor_onboarding where contractor_id=(select v::uuid from snap where k='contractor')),'Onboarding opens at revision 1 on the expected version');
select results_eq($$select revision,action,before_status,after_status,actor::text,reason,business_key from public.vendor_onboarding_events
 where contractor_id=(select v::uuid from snap where k='contractor')$$,
 $$values(1,'review_started','review','review','e1000000-0000-4000-8000-000000000001','Synthetic operator review','review-start:start-a')$$,
 'Exactly one revision-1 review_started event with actor, trimmed reason and key');
select ok((select business_key='start-a' and application_id='e3000000-0000-4000-8000-000000000001' and reason='Synthetic operator review'
 and actor='e1000000-0000-4000-8000-000000000001' and expected_version_id=pg_temp.latest('e3000000-0000-4000-8000-000000000001')
 from public.vendor_onboarding_review_starts),'Request identity is stored');
select is((select count(*) from public.vendor_application_versions where application_id='e3000000-0000-4000-8000-000000000001'),2::bigint,'Linking does not create an application version');
select ok(not public.vendor_is_eligible((select v::uuid from snap where k='contractor')),'Review contractor is not onboarding-eligible');
select ok(not private.vendor_matching_eligible((select v::uuid from snap where k='contractor')),'Review contractor is not match-eligible');
select is((select count(*)::text from public.user_roles),(select v from snap where k='roles'),'No role granted');
select is((select count(*) from auth.users where email='new-applicant@example.invalid'),0::bigint,'No Auth user created');
select is((select count(*) from public.vendor_invitation_attempts where contractor_id=(select v::uuid from snap where k='contractor')),0::bigint,'No invitation prepared');
select is((select count(*) from public.vendor_compliance_evidence where contractor_id=(select v::uuid from snap where k='contractor')),0::bigint,'No evidence recorded');
select throws_ok($$update public.vendor_onboarding_review_starts set reason='Rewritten'$$,'55000',null,'Request row is immutable');
set local role anon;
select is((select count(*) from public.contractors where id=(select v::uuid from snap where k='contractor')),0::bigint,'Anonymous listing cannot see the review contractor');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select is((select count(*) from public.contractors where id=(select v::uuid from snap where k='contractor')),0::bigint,'Authenticated listing cannot see the review contractor');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001"}',true);
select ok((select (s->>'review_started')::boolean and s->>'onboarding_status'='review' and s->>'contractor_id'=(select v from snap where k='contractor')
 and s->>'latest_version_id'=pg_temp.latest('e3000000-0000-4000-8000-000000000001')::text
 from public.vendor_onboarding_intake_status('e3000000-0000-4000-8000-000000000001') s),'Readback reports the started review');

-- Replay and non-creating calls.
insert into snap values('created',pg_temp.state());
select is(public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'Synthetic operator review','start-a'),
 (select v from fixture where k='created'),'Exact retry returns the original result');
select is(public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'Second operator check','start-b'),
 jsonb_build_object('contractor_id',(select v from snap where k='contractor'),'onboarding_status','review','onboarding_revision',1,'created',false),
 'Different key on an unchanged review returns current state without creating');
select is(pg_temp.state(),(select v from snap where k='created'),'Replay and non-creating start wrote nothing');
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'Changed reason','start-a')$$,
 'P0001','Onboarding review idempotency conflict','Same key with a changed reason conflicts');
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000007',pg_temp.latest('e3000000-0000-4000-8000-000000000007'),'Synthetic operator review','start-a')$$,
 'P0001','Onboarding review idempotency conflict','Same key for another application conflicts');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'Synthetic operator review','start-a')$$,
 'P0001','Onboarding review idempotency conflict','Same key from another operator conflicts');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001"}',true);
insert into snap values('original-version',pg_temp.latest('e3000000-0000-4000-8000-000000000001'));
update public.vendor_applications set phone='synthetic-phone-3' where id='e3000000-0000-4000-8000-000000000001';
insert into snap values('edited',pg_temp.state());
select is(public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',(select v::uuid from snap where k='original-version'),'Synthetic operator review','start-a'),
 (select v from fixture where k='created'),'Retry after an application edit returns the original result');
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'Synthetic operator review','start-a')$$,
 'P0001','Onboarding review idempotency conflict','Same key with a changed expected version conflicts');
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000001',pg_temp.latest('e3000000-0000-4000-8000-000000000001'),'Synthetic re-review','start-c')$$,
 'P0001','Onboarding already exists','Review on an older version is rejected, not reset');
select is(pg_temp.state(),(select v from snap where k='edited'),'Conflicts and older-version rejection wrote nothing');
select ok((select revision=1 and application_version_id=(select v::uuid from snap where k='original-version')
 from public.vendor_onboarding where contractor_id=(select v::uuid from snap where k='contractor')),'Older-version review stays at revision 1');

-- Existing active, suspended and rejected onboarding are rejected without mutation.
insert into fixture values('state',public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000002',
 pg_temp.latest('e3000000-0000-4000-8000-000000000002'),'Synthetic state review','state-start'));
insert into snap values('state-contractor',(select v->>'contractor_id' from fixture where k='state'));
update public.vendor_onboarding set status='active' where contractor_id=(select v::uuid from snap where k='state-contractor');
insert into snap values('active',pg_temp.state());
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000002',pg_temp.latest('e3000000-0000-4000-8000-000000000002'),'Synthetic restart','state-active')$$,
 'P0001','Onboarding already exists','Active onboarding rejected');
select is(pg_temp.state(),(select v from snap where k='active'),'Active rejection wrote nothing');
update public.vendor_onboarding set status='suspended' where contractor_id=(select v::uuid from snap where k='state-contractor');
insert into snap values('suspended',pg_temp.state());
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000002',pg_temp.latest('e3000000-0000-4000-8000-000000000002'),'Synthetic restart','state-suspended')$$,
 'P0001','Onboarding already exists','Suspended onboarding rejected');
select is(pg_temp.state(),(select v from snap where k='suspended'),'Suspended rejection wrote nothing');
update public.vendor_onboarding set status='rejected' where contractor_id=(select v::uuid from snap where k='state-contractor');
insert into snap values('rejected',pg_temp.state());
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000002',pg_temp.latest('e3000000-0000-4000-8000-000000000002'),'Synthetic restart','state-rejected')$$,
 'P0001','Onboarding already exists','Rejected onboarding rejected');
select is(pg_temp.state(),(select v from snap where k='rejected'),'Rejected-onboarding rejection wrote nothing');

-- Legacy-linked applications keep the TRACE-060/061 cutover path.
select ok(private.vendor_matching_eligible('e2000000-0000-4000-8000-000000000001'),'Legacy provider starts legacy-eligible');
insert into snap values('legacy',pg_temp.state());
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000005',pg_temp.latest('e3000000-0000-4000-8000-000000000005'),'Synthetic legacy','legacy-start')$$,
 'P0001','Existing provider requires the cutover review path','Legacy-linked application without onboarding rejected');
select is(pg_temp.state(),(select v from snap where k='legacy'),'Legacy rejection wrote nothing');
select ok(private.vendor_matching_eligible('e2000000-0000-4000-8000-000000000001'),'Legacy matching status unchanged');
select is((select count(*) from public.vendor_onboarding where contractor_id='e2000000-0000-4000-8000-000000000001'),0::bigint,'No onboarding created for legacy provider');
select public.vendor_begin_review('e2000000-0000-4000-8000-000000000002',pg_temp.latest('e3000000-0000-4000-8000-000000000006'));
insert into snap values('cutover',pg_temp.state());
select throws_ok($$select public.vendor_start_onboarding_review('e3000000-0000-4000-8000-000000000006',pg_temp.latest('e3000000-0000-4000-8000-000000000006'),'Synthetic cutover','cutover-start')$$,
 'P0001','Existing provider requires the cutover review path','Cut-over provider without a review-start request rejected');
select is(pg_temp.state(),(select v from snap where k='cutover'),'Cut-over rejection wrote nothing');

select * from finish();
rollback;
